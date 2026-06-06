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

describe("stripFinancials — KNOWN GAPS (executable evidence of finding AC-4/financial-filter)", () => {
  // The matcher is a substring denylist (price/amount/cost/gross/invoiced/deduction)
  // plus an explicit name set. Fields that name money without those tokens LEAK.
  // These tests assert the CURRENT (leaky) behaviour so the gap is visible and
  // tracked; flip each expectation when the matcher is hardened (Sprint 2/5).
  it("LEAK: a 'revenue' field is NOT stripped (no denylist token)", () => {
    const out = stripFinancials({ avgWeeklyRevenue: 12345 });
    // BUG: should be null once the financial filter is corrected.
    expect(out.avgWeeklyRevenue).toBe(12345);
  });

  it("LEAK: a 'net_payable'/'payout' style field is NOT stripped", () => {
    const out = stripFinancials({ netPayable: 999, payout: 500 });
    // BUG: both should be null once the financial filter is corrected.
    expect(out.netPayable).toBe(999);
    expect(out.payout).toBe(500);
  });
});
