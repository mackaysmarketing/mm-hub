/**
 * The live write path. This is exactly the procedure verified end-to-end on
 * real order 5024318 (design doc §3.4): re-fetch immediately before writing
 * (closes the discovery-to-write race — if the order was changed by someone
 * else in the meantime, back off rather than clobber), build the full
 * OrderInput from that fresh fetch changing ONLY the one header field, write,
 * then INDEPENDENTLY re-fetch (never trust the mutation's own echo) and diff
 * every other field. Any unexpected delta fails loudly rather than silently
 * shipping a partial write.
 *
 * Two fields go through it: consignorId (Auto FT Consignor Update) and, from
 * migration 00024, marketerId (the Woolworths marketer fill). Each write
 * changes one of them and the diff watches the other.
 */
import "server-only";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDER_BY_ID,
  Q_UPDATE_ORDER,
  orderToInput,
  type OrderHeaderOverride,
  type RspOrderById,
  type RspUpdateOrder,
  type FTOrder,
} from "@/lib/freshtrack/queries";

export type ApplyResult =
  | { outcome: "applied"; before: FTOrder; after: FTOrder }
  | { outcome: "already_assigned_by_other"; current: FTOrder }
  | { outcome: "no_longer_eligible"; reason: string; error: string; current: FTOrder }
  | { outcome: "failed"; error: string; before?: FTOrder; after?: FTOrder };

type HeaderField = "consignorId" | "marketerId";

/** Fill a BLANK consignor. Refuses if the order is no longer blank (§6.2 step 5). */
export async function applyConsignor(
  orderId: string,
  targetConsignorId: string
): Promise<ApplyResult> {
  const before = await fetchOrderById(orderId);
  if (!before) {
    return { outcome: "failed", error: `order ${orderId} not found on re-fetch` };
  }
  if (before.consignorId !== null) {
    return { outcome: "already_assigned_by_other", current: before };
  }
  return writeHeaderAndVerify(orderId, before, "consignorId", targetConsignorId);
}

/**
 * "Unassign" — the activity log's undo action. Sets consignorId back to
 * null. Unlike applyConsignor there is no "already in the target state"
 * guard here (unassigning an already-null order is a harmless no-op the
 * caller shouldn't need to special-case), but we still re-fetch fresh
 * immediately before writing, same as the assign path.
 */
export async function unassignConsignor(orderId: string): Promise<ApplyResult> {
  const before = await fetchOrderById(orderId);
  if (!before) {
    return { outcome: "failed", error: `order ${orderId} not found on re-fetch` };
  }
  return writeHeaderAndVerify(orderId, before, "consignorId", null);
}

/**
 * Fill a BLANK marketer. Refuses if a marketer has been set since discovery —
 * a third-party marketer (mangoes and other service deliveries) is never
 * overwritten, which is the whole safety case for this process.
 */
export async function applyMarketer(
  orderId: string,
  targetMarketerId: string,
  /** Re-checks the FRESH order (scope, state, archived); a reason = do not write. */
  stillEligible?: (fresh: FTOrder) => string | null
): Promise<ApplyResult> {
  const before = await fetchOrderById(orderId);
  if (!before) {
    return { outcome: "failed", error: `order ${orderId} not found on re-fetch` };
  }
  if (before.marketerId !== null) {
    return { outcome: "already_assigned_by_other", current: before };
  }
  const reason = stillEligible?.(before) ?? null;
  if (reason) return { outcome: "no_longer_eligible", reason, error: `no longer eligible: ${reason}`, current: before };
  return writeHeaderAndVerify(orderId, before, "marketerId", targetMarketerId);
}

/**
 * Undo a marketer fill: back to blank, but only while the marketer is still
 * the one this tool wrote. If someone has since changed it, their value stands.
 */
export async function clearMarketer(
  orderId: string,
  expectedMarketerId: string
): Promise<ApplyResult> {
  const before = await fetchOrderById(orderId);
  if (!before) {
    return { outcome: "failed", error: `order ${orderId} not found on re-fetch` };
  }
  if (before.marketerId !== expectedMarketerId) {
    return { outcome: "already_assigned_by_other", current: before };
  }
  return writeHeaderAndVerify(orderId, before, "marketerId", null);
}

async function writeHeaderAndVerify(
  orderId: string,
  before: FTOrder,
  field: HeaderField,
  target: string | null
): Promise<ApplyResult> {
  const override: OrderHeaderOverride =
    field === "consignorId" ? { consignorId: target } : { marketerId: target };
  const orderData = orderToInput(before, override);

  try {
    await gqlQuery<RspUpdateOrder>(Q_UPDATE_ORDER, { orderId, orderData });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { outcome: "failed", error: `updateOrder failed: ${message}`, before };
  }

  let after: FTOrder | null;
  try {
    after = await fetchOrderById(orderId);
  } catch (err) {
    // The write was sent; return (not throw) so the caller still logs it.
    const message = err instanceof Error ? err.message : String(err);
    return { outcome: "failed", error: `write sent but the check after it failed: ${message}`, before };
  }
  if (!after) {
    return {
      outcome: "failed",
      error: `order ${orderId} not found on post-write re-fetch`,
      before,
    };
  }

  const unexpectedDiffs = diffOrderExcept(before, after, field);
  if (unexpectedDiffs.length > 0) {
    return {
      outcome: "failed",
      error: `post-write diff found unexpected changes: ${unexpectedDiffs.join("; ")}`,
      before,
      after,
    };
  }
  if (after[field] !== target) {
    return {
      outcome: "failed",
      error: `${field} after write is ${after[field]}, expected ${target}`,
      before,
      after,
    };
  }

  return { outcome: "applied", before, after };
}

async function fetchOrderById(orderId: string): Promise<FTOrder | null> {
  const res = await gqlQuery<RspOrderById>(Q_ORDER_BY_ID, { orderIds: [orderId] });
  return res.orders[0] ?? null;
}

// Every field the write must leave alone. The one being written is skipped
// per call; both consignorId and marketerId are here, so each write watches
// the other.
const DIFF_FIELDS: (keyof FTOrder)[] = [
  "priority",
  "type",
  "orderNo",
  "salesOrderNo",
  "poNo",
  "comment",
  "info",
  "scheduledPickupOn",
  "actualPickupOn",
  "scheduledDeliveryOn",
  "actualDeliveryOn",
  "isEdi",
  "ediStatus",
  "totalOrdered",
  "isArchived",
  "stateId",
  "consignorId",
  "consigneeId",
  "parentConsigneeId",
  "marketAreaId",
  "marketerId",
  "supplierId",
  "deliveryContactId",
  "shedId",
  "saleEntityId",
  "latestVersionNo",
];

function diffOrderExcept(before: FTOrder, after: FTOrder, field: HeaderField): string[] {
  const diffs: string[] = [];
  for (const f of DIFF_FIELDS) {
    if (f === field) continue;
    if (before[f] !== after[f]) {
      diffs.push(`${f}: ${JSON.stringify(before[f])} -> ${JSON.stringify(after[f])}`);
    }
  }
  return diffs;
}
