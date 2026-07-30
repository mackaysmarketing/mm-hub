/**
 * Step 7: order line detail → `ft_order_items`, plus the crop set and legacy
 * rollup back onto `ft_orders`.
 *
 * WHY THIS IS A SEPARATE STEP FROM orderSync
 *   There is no bulk "items for many orders" query. Getting lines for one order
 *   costs 2 GraphQL calls: orderVersions(filterOrderId) → orderItems(
 *   filterOrderVersionId). Folding that into step 6 would mean ~2N calls per
 *   night for every order in a 90-day window (roughly 1,800 calls) and would
 *   blow the step budget. Splitting it lets step 6 stay ~5 calls and lets this
 *   step be incremental and bounded.
 *
 * INCREMENTAL "BY ABSENCE"
 *   FreshTrack gives us no modifiedOn on OrderNode, so we can't ask "which
 *   orders changed?". Instead ft_orders.items_synced_version records the
 *   latest_version_no in force when lines were last pulled, and this step only
 *   fans out where that is NULL or has fallen behind. Steady state is therefore
 *   just the day's new orders (~40 observed), i.e. ~80 calls.
 *
 * WHY THE CROP SET IS CACHED HERE
 *   crop is only reachable as orderItem.productId → product.cropId. The
 *   consignor auto-assignment process needs it for crop-specific rules (Coles
 *   Eastern Creek splits Papaya vs Passionfruit). Persisting crop_ft_ids /
 *   crop_names on ft_orders now means that process reads crops from Postgres
 *   for free instead of re-spending 2 GraphQL calls per candidate order.
 *
 * MONEY IS DELIBERATELY NOT ROLLED UP
 *   Line prices carry a `pricePer` unit (per box / kg / pallet) that varies
 *   between lines, so a summed total_amount would be arithmetic on mixed units.
 *   The Orders API runs results through stripFinancials, so a wrong number here
 *   would surface as authoritative. unit_price is set ONLY for single-line
 *   orders; total_amount is never computed. See rollupForOrder().
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDER_VERSIONS_BY_ORDER,
  Q_ORDER_ITEMS_BY_ORDER_VERSION,
  Q_PRODUCTS_ALL,
  Q_CROPS,
  type RspOrderVersions,
  type RspOrderItems,
  type RspProducts,
  type RspCrops,
  type FTOrderItem,
  type FTOrderVersion,
  type FTProductMini,
} from "@/lib/freshtrack/queries";
import {
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "orderItems";

const PARALLEL_FANOUT = 5; // mirrors palletSync
const MAX_ORDERS_PER_RUN = 600; // see note below
const UPSERT_CHUNK = 500;

/**
 * Stop fanning out once this much wall-clock has gone, flush what we have, and
 * report partial progress. The route allots this step 60s; overrunning gets the
 * whole lambda killed at Vercel's 300s ceiling, which would leave
 * ft_sync_state stuck on "running" with nothing written. Measured: 250 orders
 * = 502 GraphQL calls ≈ 36s, so 45s is roughly 300 orders of headroom and the
 * 600 cap is the outer bound, not the expected stopping point.
 */
const SOFT_BUDGET_MS = 45_000;

export interface OrderItemSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  ordersQueried: number;
  /** TRUE backlog of stale orders before this run — not capped. */
  ordersPending: number;
  /** Stale orders left after this run. */
  ordersDeferred: number;
  /** Fan-out halted on SOFT_BUDGET_MS rather than finishing its slice. */
  stoppedEarly: boolean;
  /** Orders whose latest version returned zero lines (legitimate, but notable). */
  ordersWithNoItems: number;
}

// --------------------------------------------------------------- pure bits --

/** OrderVersionNode has no `isLatest`; pick the highest versionNo. */
export function pickLatestVersion(
  versions: FTOrderVersion[]
): FTOrderVersion | null {
  if (versions.length === 0) return null;
  return versions.reduce((a, b) => (b.versionNo > a.versionNo ? b : a));
}

/**
 * NOTE: `quantity_ordered` is deliberately NOT part of this rollup. FreshTrack
 * reports OrderNode.totalOrdered at order level in BOXES (verified: an order
 * with totalOrdered 208 has a single line of palletCount 2 × boxesPerPallet
 * 104), so step 6 fills the legacy column exactly. Summing palletCount here
 * would write PALLETS into a boxes column — same number type, wrong unit, and
 * invisible once it reaches the UI. Pallet totals stay derivable from
 * ft_order_items, so there is nothing to denormalise.
 */
export interface Rollup {
  product_name: string | null;
  product_code: string | null;
  unit_price: number | null;
  crop_ft_ids: string[] | null;
  crop_names: string[] | null;
}

export function rollupForOrder(
  items: FTOrderItem[],
  productById: Map<string, FTProductMini>,
  cropNameById: Map<string, string>
): Rollup {
  if (items.length === 0) {
    return {
      product_name: null,
      product_code: null,
      unit_price: null,
      crop_ft_ids: null,
      crop_names: null,
    };
  }

  const products = items
    .map((i) => (i.productId ? productById.get(i.productId) : undefined))
    .filter((p): p is FTProductMini => Boolean(p));

  const distinctProductIds = new Set(products.map((p) => p.id));
  const single = distinctProductIds.size === 1 ? products[0] : undefined;

  const cropIds = Array.from(
    new Set(products.map((p) => p.cropId).filter((c): c is string => Boolean(c)))
  ).sort();

  return {
    product_name: single
      ? single.name
      : distinctProductIds.size > 1
        ? `${distinctProductIds.size} products`
        : null,
    product_code: single ? single.code : null,
    // Only meaningful for a single line — see file header.
    unit_price: items.length === 1 ? (items[0].priceValue ?? null) : null,
    crop_ft_ids: cropIds.length > 0 ? cropIds : null,
    crop_names:
      cropIds.length > 0
        ? cropIds.map((id) => cropNameById.get(id) ?? id)
        : null,
  };
}

export function toFtOrderItemRow(
  it: FTOrderItem,
  orderFtId: string,
  syncedAt: string
) {
  return {
    freshtrack_id: it.id,
    order_ft_id: orderFtId, // added in migration 00014 — items had no order link
    order_version_id: it.orderVersionId,
    product_ft_id: it.productId,
    shed_ft_id: it.shedId,
    dispatch_load_ft_id: it.dispatchLoadId,
    pallet_count: it.palletCount,
    boxes_per_pallet: it.boxesPerPallet,
    hand_stack: it.handStack,
    is_split: it.isSplit,
    ti: it.ti,
    unsplit_hi: it.unsplitHi,
    bottom_hi: it.bottomHi,
    top_hi: it.topHi,
    price_value: it.priceValue,
    price_currency: it.priceCurrency || null,
    price_per: it.pricePer || null,
    remitted_price_value: it.remittedPriceValue,
    remitted_price_currency: it.remittedPriceCurrency || null,
    proposed_quantity: it.proposedQuantity,
    proposed_price_value: it.proposedPriceValue,
    proposed_price_currency: it.proposedPriceCurrency || null,
    discount_value: it.discountValue,
    discount_currency: it.discountCurrency || null,
    discount_percentage: it.discountPercentage,
    item_no: it.itemNo || null,
    ean13: it.ean13 || null,
    ean14: it.ean14 || null,
    line_no: it.lineNo,
    source_modified_on: null as string | null, // not exposed by FT
    raw_json: it,
    synced_at: syncedAt,
  };
}

// ------------------------------------------------------------------ step ----

interface PendingOrder {
  freshtrack_id: string;
  latest_version_no: number | null;
}

export async function syncOrderItems(): Promise<OrderItemSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const admin = createAdminClient();

    // Which orders need lines? `items_stale` is a GENERATED column (migration
    // 00014) meaning "items_synced_version IS NULL OR < latest_version_no".
    // It exists because PostgREST cannot compare two columns in a filter —
    // `items_synced_version.lt.latest_version_no` would compare against the
    // literal string "latest_version_no", not the column.
    // TRUE backlog, uncapped. A head/exact count is one cheap round trip and
    // avoids the trap of inferring the backlog from a capped page: fetching
    // `limit MAX + 1` can only ever report "one more", which read as
    // "1 deferred" when the real figure was 1,609.
    const { count: pendingCount, error: cntErr } = await admin
      .from("ft_orders")
      .select("freshtrack_id", { count: "exact", head: true })
      .not("freshtrack_id", "is", null)
      .eq("items_stale", true);
    if (cntErr) throw new Error(`ft_orders pending count: ${cntErr.message}`);
    const ordersPending = pendingCount ?? 0;

    const { data: pendingRaw, error: pendErr } = await admin
      .from("ft_orders")
      .select("freshtrack_id, latest_version_no")
      .not("freshtrack_id", "is", null)
      .eq("items_stale", true)
      .order("scheduled_delivery_on", { ascending: false })
      .limit(MAX_ORDERS_PER_RUN);
    if (pendErr) throw new Error(`ft_orders pending scan: ${pendErr.message}`);

    const pending = (pendingRaw ?? []) as unknown as PendingOrder[];

    if (pending.length === 0) {
      await advanceWatermark(STEP, runStart, { rowsUpserted: 0, rowsSeen: 0 });
      return {
        rowsUpserted: 0,
        rowsSeen: 0,
        graphqlCalls: 0,
        ordersQueried: 0,
        ordersPending: 0,
        ordersDeferred: 0,
        stoppedEarly: false,
        ordersWithNoItems: 0,
      };
    }

    // Catalogue: 2 calls, ~258 rows, cached for the whole step.
    const [productsRes, cropsRes] = await Promise.all([
      gqlQuery<RspProducts>(Q_PRODUCTS_ALL),
      gqlQuery<RspCrops>(Q_CROPS, { limit: 200 }),
    ]);
    const productById = new Map<string, FTProductMini>(
      productsRes.products.map((p) => [p.id, p])
    );
    const cropNameById = new Map<string, string>(
      cropsRes.crops.map((c) => [c.id, c.name])
    );

    let calls = 2;
    let ordersWithNoItems = 0;
    let rowsUpserted = 0;
    let rowsSeen = 0;
    let ordersDone = 0;
    let stoppedEarly = false;
    const syncedAt = new Date().toISOString();

    for (let i = 0; i < pending.length; i += PARALLEL_FANOUT) {
      // Graceful stop: flush-per-chunk (below) means everything already
      // written stays written and items_stale clears for those orders, so the
      // next run resumes exactly where this one left off.
      if (Date.now() - runStart.getTime() > SOFT_BUDGET_MS) {
        stoppedEarly = true;
        break;
      }

      const slice = pending.slice(i, i + PARALLEL_FANOUT);
      const results = await Promise.all(
        slice.map(async (o) => {
          const vRes = await gqlQuery<RspOrderVersions>(
            Q_ORDER_VERSIONS_BY_ORDER,
            { orderId: o.freshtrack_id }
          );
          const latest = pickLatestVersion(vRes.orderVersions);
          if (!latest) return { order: o, version: null, items: [] as FTOrderItem[] };
          const iRes = await gqlQuery<RspOrderItems>(
            Q_ORDER_ITEMS_BY_ORDER_VERSION,
            { orderVersionId: latest.id }
          );
          return { order: o, version: latest, items: iRes.orderItems };
        })
      );
      calls += slice.length * 2;

      const itemRows: ReturnType<typeof toFtOrderItemRow>[] = [];
      const orderPatches: Record<string, unknown>[] = [];
      for (const r of results) {
        if (r.items.length === 0) ordersWithNoItems += 1;
        for (const it of r.items) {
          itemRows.push(toFtOrderItemRow(it, r.order.freshtrack_id, syncedAt));
        }
        const roll = rollupForOrder(r.items, productById, cropNameById);
        orderPatches.push({
          freshtrack_id: r.order.freshtrack_id,
          latest_order_version_ft_id: r.version?.id ?? null,
          // Stamp even when zero lines, else this order is re-fanned every run.
          items_synced_version: r.order.latest_version_no ?? 0,
          items_synced_at: syncedAt,
          ...roll,
        });
      }

      // Flush this chunk before fetching the next. Accumulating everything and
      // writing once at the end meant a killed lambda lost the whole run's
      // work; per-chunk commits cap the loss at one chunk. Items first, so an
      // order is never marked synced while its lines are missing.
      rowsUpserted += await upsertItems(itemRows);
      await patchOrders(orderPatches);
      rowsSeen += itemRows.length;
      ordersDone += results.length;
    }

    await advanceWatermark(STEP, runStart, { rowsUpserted, rowsSeen });

    return {
      rowsUpserted,
      rowsSeen,
      graphqlCalls: calls,
      ordersQueried: ordersDone,
      ordersPending,
      ordersDeferred: Math.max(0, ordersPending - ordersDone),
      stoppedEarly,
      ordersWithNoItems,
    };
  } catch (err) {
    await recordStepFailure(STEP, err);
    throw err;
  }
}

async function upsertItems(
  rows: ReturnType<typeof toFtOrderItemRow>[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const admin = createAdminClient();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK);
    // ft_order_items_freshtrack_id_key is a full UNIQUE (clean from 00010).
    const { error } = await admin
      .from("ft_order_items")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) {
      throw new Error(`ft_order_items upsert chunk ${i}: ${error.message}`);
    }
    upserted += slice.length;
  }
  return upserted;
}

/**
 * Write the per-order bookkeeping + rollup. Uses upsert on freshtrack_id
 * rather than N updates; every row here already exists (step 6 wrote it), and
 * the partial-column payload leaves untouched columns alone.
 */
async function patchOrders(patches: Record<string, unknown>[]): Promise<void> {
  if (patches.length === 0) return;
  const admin = createAdminClient();
  for (let i = 0; i < patches.length; i += UPSERT_CHUNK) {
    const slice = patches.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("ft_orders")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) {
      throw new Error(`ft_orders rollup patch chunk ${i}: ${error.message}`);
    }
  }
}
