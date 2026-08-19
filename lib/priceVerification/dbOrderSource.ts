/**
 * Reads the orders under test out of the locally-synced FreshTrack tables.
 *
 * WHY POSTGRES AND NOT LIVE GRAPHQL
 *   The nightly sync already resolves every trap the sprint warned about:
 *     - the consignee-association id (ft_orders.consignee_ft_id joins to
 *       ft_entities.consignee_freshtrack_id, not to the entity's own id)
 *     - order versioning (ft_orders.latest_order_version_ft_id; item rows only
 *       ever exist for the version that was latest when they were synced)
 *     - archived orders (ft_orders.is_archived)
 *   So a whole week of orders is three indexed queries instead of the ~2N
 *   GraphQL calls that hung the FreshTrack server during sprint testing. The
 *   rate-limit problem is removed rather than mitigated.
 *
 *   The tradeoff is coverage, and it is not silent: `checkCoverage()` runs
 *   before every verification and a window the sync does not hold is reported
 *   as such instead of coming back as a reassuring "0 orders, nothing wrong".
 *
 * DELIVERY DATES ARE BUCKETED IN BRISBANE, AND THE WINDOW IS OVER-FETCHED
 *   scheduled_delivery_on arrives in three shapes in real data:
 *     00:00Z (n≈1525)  local date recorded with the offset dropped
 *     14:00Z (n≈797)   a true Brisbane midnight — the NEXT calendar day local
 *     02:00Z (n≈467)   midday local
 *   Converting to Brisbane and taking the date resolves all three to the date a
 *   human means. Brisbane never observes DST, so that conversion is a fixed
 *   +10h — no timezone table needed, and no dependence on the server's own
 *   locale. Because a local day straddles two UTC days, the SQL window is
 *   widened by a day at each end and the exact bucketing is done here.
 *
 *   Note ft_orders.delivery_date (the legacy column from the Power BI view
 *   sync) disagrees with this for the 14:00Z rows — order 5023967 carries
 *   delivery_date 2026-08-01 for a 2026-08-01T14:00Z timestamp, which is
 *   2 August in Brisbane. scheduled_delivery_on is the GraphQL-sourced field
 *   and is the one used here.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderInput, OrderLineInput } from "./types";

/** Brisbane is UTC+10 year-round — Queensland does not observe DST. */
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

export interface CoverageCheck {
  covered: boolean;
  /** Earliest / latest scheduled_delivery_on the sync currently holds. */
  syncedFrom: string | null;
  syncedThrough: string | null;
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  warning: string | null;
}

/**
 * Asks whether the local sync plausibly holds the requested window, so a run
 * over an uncovered period reports "not synced" rather than "no orders found".
 */
export async function checkCoverage(
  periodStart: string,
  periodEnd: string
): Promise<CoverageCheck> {
  const admin = createAdminClient();

  const [{ data: earliest }, { data: latest }, { data: syncState }] = await Promise.all([
    admin
      .from("ft_orders")
      .select("scheduled_delivery_on")
      .not("scheduled_delivery_on", "is", null)
      .order("scheduled_delivery_on", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("ft_orders")
      .select("scheduled_delivery_on")
      .not("scheduled_delivery_on", "is", null)
      .order("scheduled_delivery_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("ft_sync_state")
      .select("last_run_status, last_run_completed_at")
      .eq("entity_type", "orders")
      .maybeSingle(),
  ]);

  const from = earliest?.scheduled_delivery_on
    ? brisbaneDate(earliest.scheduled_delivery_on as string)
    : null;
  const through = latest?.scheduled_delivery_on
    ? brisbaneDate(latest.scheduled_delivery_on as string)
    : null;

  let warning: string | null = null;
  let covered = true;

  if (!from || !through) {
    covered = false;
    warning =
      "The local FreshTrack order sync holds no orders at all, so nothing in " +
      "this quote period can be verified.";
  } else if (periodStart < from) {
    covered = false;
    warning =
      `This quote period starts ${periodStart}, but the local FreshTrack sync ` +
      `only holds orders from ${from} onward. Orders before that date are not ` +
      `available to verify — use the backtest script for historical periods.`;
  } else if (periodEnd > through) {
    covered = false;
    warning =
      `This quote period ends ${periodEnd}, but the local FreshTrack sync only ` +
      `holds orders up to ${through}. Orders after that date have not been ` +
      `synced yet.`;
  }

  if (covered && syncState?.last_run_status && syncState.last_run_status !== "success") {
    warning =
      `The last FreshTrack order sync finished with status ` +
      `"${syncState.last_run_status}", so this window may be incomplete.`;
  }

  return {
    covered,
    syncedFrom: from,
    syncedThrough: through,
    lastSyncStatus: (syncState?.last_run_status as string) ?? null,
    lastSyncAt: (syncState?.last_run_completed_at as string) ?? null,
    warning,
  };
}

/**
 * Fetches every order delivering inside [periodStart, periodEnd] (Brisbane
 * local dates, inclusive) for the given consignee entity codes, with the line
 * detail of its latest version.
 *
 * Every order in the window is returned regardless of state — including
 * Cancelled — because the report must account for all of them. Filtering by
 * state is the comparison engine's job, not this one's.
 */
export async function fetchOrdersForWindow(
  periodStart: string,
  periodEnd: string,
  entityCodes: string[]
): Promise<OrderInput[]> {
  if (entityCodes.length === 0) return [];
  const admin = createAdminClient();

  // 1. consignee association id → entity, for the codes in play.
  const { data: entities, error: entityError } = await admin
    .from("ft_entities")
    .select("entity_code, entity_name, consignee_freshtrack_id")
    .in("entity_code", entityCodes)
    .not("consignee_freshtrack_id", "is", null);
  if (entityError) throw new Error(`entity lookup failed: ${entityError.message}`);

  const byConsigneeId = new Map<string, { code: string; name: string | null }>();
  for (const e of entities ?? []) {
    byConsigneeId.set(e.consignee_freshtrack_id as string, {
      code: e.entity_code as string,
      name: (e.entity_name as string) ?? null,
    });
  }
  if (byConsigneeId.size === 0) return [];

  // 2. Orders in a deliberately wide UTC window; bucketed to Brisbane below.
  const fromUtc = `${addDays(periodStart, -1)}T00:00:00Z`;
  const toUtc = `${addDays(periodEnd, 2)}T00:00:00Z`;

  const { data: orderRows, error: orderError } = await admin
    .from("ft_orders")
    .select("freshtrack_id, order_number, state_name, scheduled_delivery_on, consignee_ft_id, latest_order_version_ft_id, is_archived")
    .in("consignee_ft_id", Array.from(byConsigneeId.keys()))
    .gte("scheduled_delivery_on", fromUtc)
    .lt("scheduled_delivery_on", toUtc)
    .order("scheduled_delivery_on", { ascending: true });
  if (orderError) throw new Error(`order lookup failed: ${orderError.message}`);

  const orders = (orderRows ?? []).filter((o) => {
    if (o.is_archived === true) return false;
    const local = brisbaneDate(o.scheduled_delivery_on as string);
    return local !== null && local >= periodStart && local <= periodEnd;
  });
  if (orders.length === 0) return [];

  // 3. Line detail for the latest version of each order.
  const versionIds = Array.from(
    new Set(
      orders
        .map((o) => o.latest_order_version_ft_id as string | null)
        .filter((v): v is string => !!v)
    )
  );
  const itemsByVersion = await fetchItems(versionIds);

  return orders.map((o) => {
    const entity = byConsigneeId.get(o.consignee_ft_id as string);
    const versionId = o.latest_order_version_ft_id as string | null;
    return {
      orderFtId: o.freshtrack_id as string,
      orderNo: (o.order_number as string) ?? null,
      stateName: (o.state_name as string) ?? null,
      consigneeCode: entity?.code ?? null,
      consigneeName: entity?.name ?? null,
      deliveryDate: brisbaneDate(o.scheduled_delivery_on as string),
      lines: versionId ? (itemsByVersion.get(versionId) ?? []) : [],
    } satisfies OrderInput;
  });
}

/**
 * Line detail, chunked. A week of orders can carry well over a thousand
 * versions and a single `.in()` of that size makes a URL long enough for
 * PostgREST to reject it.
 */
async function fetchItems(
  versionIds: string[]
): Promise<Map<string, OrderLineInput[]>> {
  const admin = createAdminClient();
  const CHUNK = 200;
  const out = new Map<string, OrderLineInput[]>();

  for (let i = 0; i < versionIds.length; i += CHUNK) {
    const chunk = versionIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("ft_order_items")
      .select("order_version_id, line_no, item_no, price_value, price_per, proposed_quantity")
      .in("order_version_id", chunk);
    if (error) throw new Error(`order item lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      const key = row.order_version_id as string;
      const bucket = out.get(key) ?? [];
      bucket.push({
        lineNo: (row.line_no as number) ?? null,
        itemNo: row.item_no === null ? null : String(row.item_no),
        // ft_order_items has no description of its own; the quote row supplies
        // one in the report, which is the label the retailer actually uses.
        description: null,
        quantity: (row.proposed_quantity as number) ?? null,
        priceValue: row.price_value === null ? null : Number(row.price_value),
        pricePer: (row.price_per as string) ?? null,
      });
      out.set(key, bucket);
    }
  }

  for (const lines of Array.from(out.values())) {
    lines.sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
  }
  return out;
}

/** ISO timestamp → Brisbane calendar date (yyyy-mm-dd). */
export function brisbaneDate(ts: string | null): string | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}
