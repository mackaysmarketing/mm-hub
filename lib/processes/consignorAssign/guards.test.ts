import { describe, it, expect } from "vitest";
import { checkOrderGuards, type OrderGuardInput } from "./guards";

const ASSIGNABLE = ["OR", "FORD", "Default"];

function order(over: Partial<OrderGuardInput> = {}): OrderGuardInput {
  return {
    isArchived: false,
    stateCode: "OR",
    actualPickupOn: null,
    actualDeliveryOn: null,
    ...over,
  };
}

describe("checkOrderGuards", () => {
  it("passes a normal Ordered order", () => {
    expect(checkOrderGuards(order(), ASSIGNABLE)).toBeNull();
  });

  it("blocks an archived order regardless of state", () => {
    expect(checkOrderGuards(order({ isArchived: true }), ASSIGNABLE)).toBe("archived");
  });

  it("blocks a Cancelled order — the load-bearing guard", () => {
    expect(checkOrderGuards(order({ stateCode: "CA" }), ASSIGNABLE)).toBe(
      "state_not_assignable"
    );
  });

  it("blocks any state not on the allow-list, e.g. Shipped/Invoiced", () => {
    expect(checkOrderGuards(order({ stateCode: "SH" }), ASSIGNABLE)).toBe(
      "state_not_assignable"
    );
    expect(checkOrderGuards(order({ stateCode: "IN" }), ASSIGNABLE)).toBe(
      "state_not_assignable"
    );
  });

  it("fails closed on a null/unresolved state code rather than assuming it's fine", () => {
    expect(checkOrderGuards(order({ stateCode: null }), ASSIGNABLE)).toBe(
      "state_not_assignable"
    );
  });

  it("fails closed on a state code the allow-list has never heard of", () => {
    expect(checkOrderGuards(order({ stateCode: "BRAND_NEW_STATE" }), ASSIGNABLE)).toBe(
      "state_not_assignable"
    );
  });

  it("flags the anomaly case: actual pickup set despite still being a candidate", () => {
    expect(
      checkOrderGuards(order({ actualPickupOn: "2026-07-28T00:00:00Z" }), ASSIGNABLE)
    ).toBe("anomaly_progressed_without_consignor");
  });

  it("flags the anomaly case on actual delivery too", () => {
    expect(
      checkOrderGuards(order({ actualDeliveryOn: "2026-07-28T00:00:00Z" }), ASSIGNABLE)
    ).toBe("anomaly_progressed_without_consignor");
  });

  it("archived takes priority over the anomaly check", () => {
    expect(
      checkOrderGuards(
        order({ isArchived: true, actualPickupOn: "2026-07-28T00:00:00Z" }),
        ASSIGNABLE
      )
    ).toBe("archived");
  });
});
