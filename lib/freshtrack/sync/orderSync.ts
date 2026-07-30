/**
 * Step 6: customer orders → `ft_orders`.
 *
 * WINDOW STRATEGY (differs from every other step — read this before editing)
 *
 *   `orders` exposes NO filterLastModifiedOnStart. Verified against live FT
 *   2026-07-30: the server rejects it outright with
 *     "Unknown argument 'filterLastModifiedOnStart' on field 'Query.orders'".
 *   The header comment in cursor.ts lists OrderNode among nodes that accept it
 *   — that comment is wrong. OrderNode also has no modifiedOn field, and
 *   latestVersionNo was 1 on every order sampled, so versions are not a usable
 *   change signal either.
 *
 *   Consequence: there is no true incremental sync for orders. This step
 *   re-sweeps a scheduledDeliveryOn window every run and leans on upsert
 *   idempotency (freshtrack_id). The watermark in ft_sync_state is therefore
 *   only "have we ever run + last run metadata", exactly as dispatchSync uses
 *   it — it does NOT bound the query.
 *
 *   The window is scheduledDeliveryOn and it extends FORWARD. dispatchSync
 *   windows on actualPickupOn, which is null for anything not yet shipped;
 *   copying that here would miss every forward-dated order, i.e. precisely the
 *   ones the consignor auto-assignment process exists to act on.
 *
 * Cost: cheap. `ftPagedDateWindow` halves the window on overflow, so a ~90 day
 * span is a handful of calls. The expensive per-order fan-out (versions +
 * items) is step 7, deliberately separate — see orderItemSync.ts.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDERS_BY_DELIVERY_WINDOW,
  Q_ORDER_STATES,
  type RspOrders,
  type RspOrderStates,
  type FTOrder,
  type FTOrderState,
} from "@/lib/freshtrack/queries";
import { ftPagedDateWindow } from "./windowing";
import { mapConsignorsToFarms, mapConsigneesToNames } from "./consignorFarmMap";
import {
  getWatermark,
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "orders";

const DEFAULT_LOOKBACK_DAYS = 30; // first run, mirrors dispatchSync
const RECURRING_LOOKBACK_DAYS = 14; // catches retroactive edits
const DEFAULT_HORIZON_DAYS = 60; // forward reach; orders observed ≤ ~3 weeks out
const FT_LIMIT = 1_000;
const UPSERT_CHUNK = 500;

export interface OrderSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  windowStart: Date;
  windowEnd: Date;
  windows: number;
  /** Orders whose legacy order_date could not be derived (invisible to /api/orders). */
  missingOrderDate: number;
  /** consignor role ids that matched no provisioned farm — expected for DCs. */
  unresolvedConsignors: number;
  /** marketerId → count. Watches for non-Mackays orders appearing in the tenant. */
  marketerBreakdown: Record<string, number>;
  /** Feeds step 7 without it having to re-query. */
  orderIds: string[];
}

// --------------------------------------------------------------- pure bits --
// Exported for unit tests; no I/O.

export interface OrderWindow {
  start: Date;
  end: Date;
}

export function computeOrderWindow(
  watermark: Date | null,
  now: Date,
  opts?: { lookbackDays?: number; horizonDays?: number }
): OrderWindow {
  const lookbackDays =
    opts?.lookbackDays ??
    (watermark ? RECURRING_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS);
  const horizonDays = opts?.horizonDays ?? DEFAULT_HORIZON_DAYS;
  return {
    start: new Date(now.getTime() - lookbackDays * 86_400_000),
    end: new Date(now.getTime() + horizonDays * 86_400_000),
  };
}

/** ISO date (YYYY-MM-DD) from an ISO timestamp, or null. */
export function isoDatePart(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Legacy `order_date`. OrderNode exposes no created/raised date, and
 * app/api/orders/route.ts does `.gte("order_date", ...)` — which drops NULLs —
 * so leaving this null hides the row from the Orders page entirely. Best
 * available proxy is the delivery axis.
 */
export function deriveLegacyOrderDate(o: FTOrder): string | null {
  return isoDatePart(o.scheduledDeliveryOn) ?? isoDatePart(o.scheduledPickupOn);
}

export function deriveLegacyDeliveryDate(o: FTOrder): string | null {
  return isoDatePart(o.actualDeliveryOn) ?? isoDatePart(o.scheduledDeliveryOn);
}

export interface OrderRowCtx {
  stateNameById: Map<string, string>;
  growerIdByConsignor: Map<string, string>;
  consigneeInfoById: Map<string, { code: string | null; name: string | null }>;
  syncedAt: string;
}

export function toFtOrderRow(o: FTOrder, ctx: OrderRowCtx) {
  const consignee = o.consigneeId
    ? ctx.consigneeInfoById.get(o.consigneeId)
    : undefined;
  return {
    freshtrack_id: o.id,
    grower_id: o.consignorId
      ? ctx.growerIdByConsignor.get(o.consignorId) ?? null
      : null,

    // --- FreshTrack-native ---
    order_number: o.orderNo || null,
    sales_order_no: o.salesOrderNo || null,
    po_no: o.poNo || null,
    order_type: o.type || null,
    priority: o.priority,
    comment: o.comment || null,
    info: o.info || null,
    total_ordered: o.totalOrdered,
    scheduled_pickup_on: o.scheduledPickupOn,
    actual_pickup_on: o.actualPickupOn,
    scheduled_delivery_on: o.scheduledDeliveryOn,
    actual_delivery_on: o.actualDeliveryOn,
    is_edi: o.isEdi,
    edi_status: o.ediStatus,
    is_archived: o.isArchived,
    latest_version_no: o.latestVersionNo,
    state_ft_id: o.stateId,
    state_name: ctx.stateNameById.get(o.stateId) ?? null,
    consignor_ft_id: o.consignorId,
    consignee_ft_id: o.consigneeId,
    parent_consignee_ft_id: o.parentConsigneeId,
    marketer_ft_id: o.marketerId,
    supplier_ft_id: o.supplierId,
    shed_ft_id: o.shedId,
    market_area_ft_id: o.marketAreaId,
    delivery_contact_ft_id: o.deliveryContactId,
    sale_entity_ft_id: o.saleEntityId,

    // --- Legacy compat (migration 00001 vintage; see 00014 comments) ---
    // Consumed by app/api/orders/route.ts. Per-ITEM fields (product_name,
    // variety, grade, unit_price, total_amount) are intentionally NOT set here
    // — they are per-line, not per-order. Step 7 rolls them up once items are
    // known. Leaving them null is honest; guessing is not.
    //
    // quantity_ordered IS set here, from OrderNode.totalOrdered: FreshTrack
    // reports it at order level in BOXES (verified — an order with
    // totalOrdered 208 has one line of palletCount 2 × boxesPerPallet 104).
    // Deriving it in step 7 from summed palletCount would silently record
    // pallets in a boxes column, so it belongs here where it is exact.
    quantity_ordered: o.totalOrdered,
    order_date: deriveLegacyOrderDate(o),
    delivery_date: deriveLegacyDeliveryDate(o),
    customer_code: consignee?.code ?? null,
    customer_name: consignee?.name ?? null,
    status: ctx.stateNameById.get(o.stateId) ?? null,

    // No modifiedOn exists on OrderNode — keep null rather than fake it.
    source_modified_on: null as string | null,
    raw_json: o,
    synced_at: ctx.syncedAt,
  };
}

// ------------------------------------------------------------------ step ----

export async function syncOrders(): Promise<OrderSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const watermark = await getWatermark(STEP);
    const { start: windowStart, end: windowEnd } = computeOrderWindow(
      watermark,
      runStart,
      {
        horizonDays: numFromEnv("FT_ORDERS_HORIZON_DAYS", DEFAULT_HORIZON_DAYS),
      }
    );

    // Order states: one cheap call, no filter args, ~13 rows.
    const statesRes = await gqlQuery<RspOrderStates>(Q_ORDER_STATES);
    const stateNameById = new Map<string, string>(
      statesRes.orderStates.map((s: FTOrderState) => [s.id, s.name])
    );

    const swept = await ftPagedDateWindow<FTOrder>(
      windowStart,
      windowEnd,
      { limit: FT_LIMIT },
      async (wStart, wEnd) => {
        const res = await gqlQuery<RspOrders>(Q_ORDERS_BY_DELIVERY_WINDOW, {
          limit: FT_LIMIT,
          deliveryStart: wStart.toISOString(),
          deliveryEnd: wEnd.toISOString(),
        });
        return res.orders;
      },
      (o) => o.id
    );
    const orders = swept.rows;

    const [{ byConsignorId, unresolved }, consigneeInfoById] = await Promise.all([
      mapConsignorsToFarms(orders.map((o) => o.consignorId)),
      mapConsigneesToNames(orders.map((o) => o.consigneeId)),
    ]);

    const ctx: OrderRowCtx = {
      stateNameById,
      growerIdByConsignor: byConsignorId,
      consigneeInfoById,
      syncedAt: new Date().toISOString(),
    };
    const rows = orders.map((o) => toFtOrderRow(o, ctx));

    const rowsUpserted = await upsertOrders(rows);

    // NOTE: cursor advances to runStart, NOT windowEnd — windowEnd is in the
    // future and would poison the "have we ever run" signal.
    await advanceWatermark(STEP, runStart, {
      rowsUpserted,
      rowsSeen: orders.length,
    });

    const marketerBreakdown: Record<string, number> = {};
    for (const o of orders) {
      const k = o.marketerId ?? "null";
      marketerBreakdown[k] = (marketerBreakdown[k] ?? 0) + 1;
    }

    return {
      rowsUpserted,
      rowsSeen: orders.length,
      graphqlCalls: swept.calls + 1, // + orderStates
      windowStart,
      windowEnd,
      windows: swept.windows,
      missingOrderDate: rows.filter((r) => r.order_date === null).length,
      unresolvedConsignors: unresolved.length,
      marketerBreakdown,
      orderIds: orders.map((o) => o.id),
    };
  } catch (err) {
    await recordStepFailure(STEP, err);
    throw err;
  }
}

function numFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function upsertOrders(
  rows: ReturnType<typeof toFtOrderRow>[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const admin = createAdminClient();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK);
    // Requires the FULL unique index on freshtrack_id — migration 00014.
    // Against the pre-00014 partial index this fails with 42P10.
    const { error } = await admin
      .from("ft_orders")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) throw new Error(`ft_orders upsert chunk ${i}: ${error.message}`);
    upserted += slice.length;
  }
  return upserted;
}
