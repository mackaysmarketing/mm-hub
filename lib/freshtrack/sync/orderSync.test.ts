import { describe, it, expect, vi } from "vitest";

// `server-only` throws outside a server context; stub it. vi.mock is hoisted.
vi.mock("server-only", () => ({}));
// Keep the module graph free of Supabase/FT clients — we only test pure logic.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));

import {
  computeOrderWindow,
  isoDatePart,
  deriveLegacyOrderDate,
  deriveLegacyDeliveryDate,
  toFtOrderRow,
  type OrderRowCtx,
} from "./orderSync";
import type { FTOrder } from "@/lib/freshtrack/queries";

const DAY = 86_400_000;
const NOW = new Date("2026-07-30T00:00:00.000Z");

function makeOrder(over: Partial<FTOrder> = {}): FTOrder {
  return {
    id: "019fb00d-ddab-e679-2b77-b3a371aa3137",
    priority: null,
    type: "S",
    orderNo: "5024231",
    salesOrderNo: "",
    poNo: "2991193",
    comment: "",
    info: "COLEC SYDN SAT",
    scheduledPickupOn: "2026-07-31T14:00:00+00:00",
    actualPickupOn: null,
    scheduledDeliveryOn: "2026-07-31T14:00:00+00:00",
    actualDeliveryOn: null,
    isEdi: true,
    ediStatus: "PCON",
    totalOrdered: 208,
    isArchived: false,
    stateId: "84e98a1e-beac-429b-a9f3-56e54d09f4ce",
    consignorId: "019588ed-e54e-c954-1696-81581dae4e50",
    consigneeId: "01943e52-06fd-8034-8499-60aaa2db52a3",
    parentConsigneeId: "01951c30-b831-ee0a-f0af-f03f97be2753",
    marketAreaId: "0191e982-4358-ea91-a189-e3bda9350b88",
    marketerId: "0192035b-0cf8-4e5f-8675-e6144ff7df99",
    supplierId: null,
    deliveryContactId: "0195028b-bd9e-cad7-c94f-e618ef7124ca",
    shedId: null,
    saleEntityId: null,
    latestVersionNo: 1,
    ...over,
  };
}

function makeCtx(over: Partial<OrderRowCtx> = {}): OrderRowCtx {
  return {
    stateNameById: new Map([["84e98a1e-beac-429b-a9f3-56e54d09f4ce", "Ordered"]]),
    growerIdByConsignor: new Map(),
    consigneeInfoById: new Map([
      [
        "01943e52-06fd-8034-8499-60aaa2db52a3",
        { code: "COLEC", name: "Coles Eastern Creek" },
      ],
    ]),
    syncedAt: "2026-07-30T00:00:00.000Z",
    ...over,
  };
}

describe("computeOrderWindow", () => {
  it("uses the 30-day first-run lookback when there is no watermark", () => {
    const w = computeOrderWindow(null, NOW);
    expect(w.start.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("narrows to the 14-day recurring lookback once a watermark exists", () => {
    const w = computeOrderWindow(new Date("2026-07-29T06:00:00Z"), NOW);
    expect(w.start.getTime()).toBe(NOW.getTime() - 14 * DAY);
  });

  it("reaches FORWARD of now — the whole point vs dispatchSync", () => {
    const w = computeOrderWindow(null, NOW);
    expect(w.end.getTime()).toBe(NOW.getTime() + 60 * DAY);
    expect(w.end.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("honours explicit overrides", () => {
    const w = computeOrderWindow(null, NOW, { lookbackDays: 1, horizonDays: 2 });
    expect(w.start.getTime()).toBe(NOW.getTime() - DAY);
    expect(w.end.getTime()).toBe(NOW.getTime() + 2 * DAY);
  });
});

describe("isoDatePart", () => {
  it("extracts the date portion", () => {
    expect(isoDatePart("2026-07-31T14:00:00+00:00")).toBe("2026-07-31");
  });
  it("returns null for null/empty/garbage rather than throwing", () => {
    expect(isoDatePart(null)).toBeNull();
    expect(isoDatePart(undefined)).toBeNull();
    expect(isoDatePart("")).toBeNull();
    expect(isoDatePart("not-a-date")).toBeNull();
  });
});

describe("legacy date derivation", () => {
  it("prefers scheduledDeliveryOn for order_date", () => {
    expect(deriveLegacyOrderDate(makeOrder())).toBe("2026-07-31");
  });

  it("falls back to scheduledPickupOn when delivery is unset", () => {
    const o = makeOrder({
      scheduledDeliveryOn: null,
      scheduledPickupOn: "2026-08-02T00:00:00Z",
    });
    expect(deriveLegacyOrderDate(o)).toBe("2026-08-02");
  });

  it("returns null when both are unset — such a row is INVISIBLE to /api/orders, which does .gte(order_date)", () => {
    const o = makeOrder({ scheduledDeliveryOn: null, scheduledPickupOn: null });
    expect(deriveLegacyOrderDate(o)).toBeNull();
  });

  it("prefers actualDeliveryOn for delivery_date once it exists", () => {
    const o = makeOrder({ actualDeliveryOn: "2026-08-01T09:00:00Z" });
    expect(deriveLegacyDeliveryDate(o)).toBe("2026-08-01");
  });
});

describe("toFtOrderRow", () => {
  it("maps the FreshTrack-native fields", () => {
    const row = toFtOrderRow(makeOrder(), makeCtx());
    expect(row.freshtrack_id).toBe("019fb00d-ddab-e679-2b77-b3a371aa3137");
    expect(row.order_number).toBe("5024231");
    expect(row.po_no).toBe("2991193");
    expect(row.consignor_ft_id).toBe("019588ed-e54e-c954-1696-81581dae4e50");
    expect(row.consignee_ft_id).toBe("01943e52-06fd-8034-8499-60aaa2db52a3");
    expect(row.state_ft_id).toBe("84e98a1e-beac-429b-a9f3-56e54d09f4ce");
    expect(row.is_edi).toBe(true);
    expect(row.edi_status).toBe("PCON");
    expect(row.latest_version_no).toBe(1);
  });

  it("denormalises the state name into both state_name and legacy status", () => {
    const row = toFtOrderRow(makeOrder(), makeCtx());
    expect(row.state_name).toBe("Ordered");
    expect(row.status).toBe("Ordered");
  });

  it("resolves the consignee into the legacy customer columns /api/orders searches", () => {
    const row = toFtOrderRow(makeOrder(), makeCtx());
    expect(row.customer_code).toBe("COLEC");
    expect(row.customer_name).toBe("Coles Eastern Creek");
  });

  it("leaves grower_id null when the consignor is not a provisioned farm (DC/ripening centre)", () => {
    const row = toFtOrderRow(makeOrder(), makeCtx());
    expect(row.grower_id).toBeNull();
  });

  it("sets grower_id when the consignor does map to a farm", () => {
    const ctx = makeCtx({
      growerIdByConsignor: new Map([
        ["019588ed-e54e-c954-1696-81581dae4e50", "farm-uuid-1"],
      ]),
    });
    expect(toFtOrderRow(makeOrder(), ctx).grower_id).toBe("farm-uuid-1");
  });

  it("does NOT invent per-line values — product/price are step 7's job", () => {
    const row = toFtOrderRow(makeOrder(), makeCtx()) as Record<string, unknown>;
    for (const k of [
      "product_name",
      "product_code",
      "variety",
      "grade",
      "quantity_dispatched",
      "unit_price",
      "total_amount",
    ]) {
      expect(row[k]).toBeUndefined();
    }
  });

  it("fills legacy quantity_ordered from totalOrdered (BOXES), not from pallet counts", () => {
    const row = toFtOrderRow(makeOrder({ totalOrdered: 208 }), makeCtx());
    expect(row.quantity_ordered).toBe(208);
    expect(row.total_ordered).toBe(208);
  });

  it("keeps source_modified_on null — FreshTrack exposes no modifiedOn on OrderNode", () => {
    expect(toFtOrderRow(makeOrder(), makeCtx()).source_modified_on).toBeNull();
  });

  it("tolerates an unknown stateId instead of throwing", () => {
    const row = toFtOrderRow(
      makeOrder({ stateId: "00000000-0000-0000-0000-000000000000" }),
      makeCtx()
    );
    expect(row.state_name).toBeNull();
    expect(row.status).toBeNull();
  });

  it("normalises FreshTrack's empty-string scalars to null", () => {
    const row = toFtOrderRow(makeOrder({ salesOrderNo: "", comment: "" }), makeCtx());
    expect(row.sales_order_no).toBeNull();
    expect(row.comment).toBeNull();
  });
});
