/**
 * The live write path. This is exactly the procedure verified end-to-end on
 * real order 5024318 (design doc §3.4): re-fetch immediately before writing
 * (closes the discovery-to-write race — if the order was assigned by someone
 * else in the meantime, back off rather than clobber), build the full
 * OrderInput from that fresh fetch changing ONLY consignorId, write, then
 * INDEPENDENTLY re-fetch (never trust the mutation's own echo) and diff every
 * other field. Any unexpected delta fails loudly rather than silently
 * shipping a partial write.
 */
import "server-only";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDER_BY_ID,
  Q_UPDATE_ORDER_CONSIGNOR,
  orderToInputWithConsignor,
  type RspOrderById,
  type RspUpdateOrder,
  type FTOrder,
} from "@/lib/freshtrack/queries";

export type ApplyResult =
  | { outcome: "applied"; before: FTOrder; after: FTOrder }
  | { outcome: "already_assigned_by_other"; current: FTOrder }
  | { outcome: "failed"; error: string; before?: FTOrder; after?: FTOrder };

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
  return writeConsignorAndVerify(orderId, before, targetConsignorId);
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
  return writeConsignorAndVerify(orderId, before, null);
}

async function writeConsignorAndVerify(
  orderId: string,
  before: FTOrder,
  targetConsignorId: string | null
): Promise<ApplyResult> {
  const orderData = orderToInputWithConsignor(before, targetConsignorId);

  try {
    await gqlQuery<RspUpdateOrder>(Q_UPDATE_ORDER_CONSIGNOR, { orderId, orderData });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { outcome: "failed", error: `updateOrder failed: ${message}`, before };
  }

  const after = await fetchOrderById(orderId);
  if (!after) {
    return {
      outcome: "failed",
      error: `order ${orderId} not found on post-write re-fetch`,
      before,
    };
  }

  const unexpectedDiffs = diffOrderExceptConsignor(before, after);
  if (unexpectedDiffs.length > 0) {
    return {
      outcome: "failed",
      error: `post-write diff found unexpected changes: ${unexpectedDiffs.join("; ")}`,
      before,
      after,
    };
  }
  if (after.consignorId !== targetConsignorId) {
    return {
      outcome: "failed",
      error: `consignorId after write is ${after.consignorId}, expected ${targetConsignorId}`,
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

// consignorId is deliberately excluded — that's the one field allowed to change.
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

function diffOrderExceptConsignor(before: FTOrder, after: FTOrder): string[] {
  const diffs: string[] = [];
  for (const field of DIFF_FIELDS) {
    if (before[field] !== after[field]) {
      diffs.push(
        `${field}: ${JSON.stringify(before[field])} -> ${JSON.stringify(after[field])}`
      );
    }
  }
  return diffs;
}
