import { describe, it, expect } from "vitest";
import { stripFinancials } from "./financial-filter";

describe("stripFinancials — correct behaviour", () => {
  it("nulls known monetary fields and keeps non-financial ones", () => {
    const out = stripFinancials({
      rcti_ref: "R-100",
      grower_name: "Acme",
      total_gross: 1000,
      total_invoiced: 800,
      unit_price: 4.5,
      total_quantity: 200,
    });
    expect(out.total_gross).toBeNull();
    expect(out.total_invoiced).toBeNull();
    expect(out.unit_price).toBeNull();
    // non-financial fields are preserved
    expect(out.rcti_ref).toBe("R-100");
    expect(out.grower_name).toBe("Acme");
    expect(out.total_quantity).toBe(200);
  });

  it("nulls (not zeros) so the UI can distinguish hidden from zero", () => {
    const out = stripFinancials({ total_gross: 0 });
    expect(out.total_gross).toBeNull();
    expect(out.total_gross).not.toBe(0);
  });

  it("recurses into arrays and nested objects", () => {
    const out = stripFinancials({
      lineItems: [{ product: "Bananas", total_amount: 50 }],
    });
    expect(out.lineItems[0].product).toBe("Bananas");
    expect(out.lineItems[0].total_amount).toBeNull();
  });
});

describe("stripFinancials — previously-leaking fields now redacted (AC-4 fix)", () => {
  // The matcher now covers revenue/payable/payout in addition to the original
  // price/amount/cost/gross/invoiced/deduction tokens.
  it("strips a 'revenue' field", () => {
    expect(stripFinancials({ avgWeeklyRevenue: 12345 }).avgWeeklyRevenue).toBeNull();
  });

  it("strips 'net_payable'/'payout' style fields", () => {
    const out = stripFinancials({ netPayable: 999, payout: 500 });
    expect(out.netPayable).toBeNull();
    expect(out.payout).toBeNull();
  });

  it("does not over-strip a non-financial field that merely contains a substring", () => {
    // guards against false positives — 'quantity'/'weight_kg' must survive
    const out = stripFinancials({ total_quantity: 200, weight_kg: 18.5 });
    expect(out.total_quantity).toBe(200);
    expect(out.weight_kg).toBe(18.5);
  });
});
