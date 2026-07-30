/**
 * Pure order-level eligibility guards — run BEFORE rule matching, since they
 * only need fields already in hand from discovery (no extra GraphQL calls),
 * and there's no point paying for crop resolution on an order we're going to
 * skip anyway.
 *
 * Deliberately NOT included: a pallets/dispatch-attached check. It would cost
 * an extra live query per candidate to detect a combination (dispatched or
 * palletised, yet still consignor-null) that has no observed real example —
 * every sampled order with actualPickupOn/actualDeliveryOn set already had a
 * consignor. actualPickupOn/actualDeliveryOn (free — already fetched at
 * discovery) still catch the same anomaly at no extra cost.
 */

export interface OrderGuardInput {
  isArchived: boolean;
  stateCode: string | null;
  actualPickupOn: string | null;
  actualDeliveryOn: string | null;
}

export type GuardSkipReason =
  | "archived"
  | "state_not_assignable"
  | "anomaly_progressed_without_consignor";

export function checkOrderGuards(
  input: OrderGuardInput,
  assignableStateCodes: string[]
): GuardSkipReason | null {
  if (input.isArchived) return "archived";
  if (!input.stateCode || !assignableStateCodes.includes(input.stateCode)) {
    return "state_not_assignable";
  }
  if (input.actualPickupOn || input.actualDeliveryOn) {
    return "anomaly_progressed_without_consignor";
  }
  return null;
}
