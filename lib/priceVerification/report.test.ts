import { describe, it, expect } from "vitest";
import { buildCsv, buildSummary } from "./report";
import type { ComparedOrder, VerificationTotals } from "./types";

function order(over: Partial<ComparedOrder> = {}): ComparedOrder {
  return {
    orderFtId: "ft-1",
    orderNo: "5000001",
    stateName: "Ordered",
    consigneeCode: "COLBR",
    consigneeName: "Coles Parkinson",
    dcCode: "BRI9415",
    deliveryDate: "2026-04-08",
    outcome: "verified",
    reason: null,
    duplicateGroup: null,
    isDuplicate: false,
    linesTotal: 1,
    linesMatched: 1,
    linesMismatched: 0,
    linesNoQuote: 0,
    lines: [
      {
        lineNo: 1,
        itemNo: "4246862",
        description: "AVOCADO 5PK SHEPARD 12",
        quantity: 10,
        orderPrice: 42,
        pricePer: "BOX",
        quotePrice: 42,
        variance: 0,
        outcome: "match",
        detail: null,
      },
    ],
    ...over,
  };
}

function rowsOf(csv: string): string[] {
  return csv.split("\r\n");
}

describe("CSV report", () => {
  it("emits a header plus one row per line", () => {
    const csv = buildCsv([order()]);
    const rows = rowsOf(csv);
    expect(rows[0]).toContain("Order No");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("5000001");
    expect(rows[1]).toContain("4246862");
  });

  it("still emits a row for an order that has no lines", () => {
    // A cancelled or unmapped order must be visible in the export. Omitting it
    // would make the file read like a clean bill of health.
    const csv = buildCsv([
      order({
        outcome: "skipped",
        reason: 'order state "Cancelled" is excluded',
        linesTotal: 0,
        linesMatched: 0,
        lines: [],
      }),
    ]);
    const rows = rowsOf(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("skipped");
    expect(rows[1]).toContain("Cancelled");
  });

  it("accounts for every order exactly once", () => {
    const orders = [
      order({ orderNo: "1" }),
      order({ orderNo: "2", outcome: "skipped", lines: [], linesTotal: 0 }),
      order({ orderNo: "3", outcome: "unmapped", lines: [], linesTotal: 0 }),
    ];
    const csv = buildCsv(orders);
    for (const n of ["1", "2", "3"]) {
      const hits = rowsOf(csv).filter((r) => r.startsWith(`${n},`));
      expect(hits, `order ${n}`).toHaveLength(1);
    }
  });

  it("quotes a value containing a comma", () => {
    const csv = buildCsv([
      order({
        lines: [
          {
            ...order().lines[0]!,
            description: "BANANA, KIDS 5PK",
          },
        ],
      }),
    ]);
    expect(csv).toContain('"BANANA, KIDS 5PK"');
  });

  it("escapes embedded double quotes", () => {
    const csv = buildCsv([
      order({
        lines: [{ ...order().lines[0]!, description: 'AVO 5" PACK' }],
      }),
    ]);
    expect(csv).toContain('"AVO 5"" PACK"');
  });

  it("neutralises a value that Excel would treat as a formula", () => {
    const csv = buildCsv([
      order({
        lines: [{ ...order().lines[0]!, description: "=1+1" }],
      }),
    ]);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1,/);
  });

  it("marks a duplicate order in its own column", () => {
    const csv = buildCsv([order({ isDuplicate: true, duplicateGroup: "dup-abc" })]);
    expect(csv).toContain("duplicate of dup-abc");
  });

  it("writes a negative variance without mangling it", () => {
    const csv = buildCsv([
      order({
        outcome: "mismatch",
        lines: [{ ...order().lines[0]!, orderPrice: 40, variance: -2, outcome: "mismatch" }],
      }),
    ]);
    // A leading "-" is formula-guarded, so the raw value stays readable.
    expect(csv).toContain("'-2");
  });
});

describe("summary", () => {
  const totals: VerificationTotals = {
    ordersTotal: 7,
    ordersVerified: 7,
    ordersMismatched: 0,
    ordersPartial: 0,
    ordersNoQuote: 0,
    ordersSkipped: 0,
    ordersUnmapped: 0,
    ordersDuplicate: 0,
    linesTotal: 19,
    linesMatched: 19,
    linesMismatched: 0,
    linesNoQuote: 0,
  };

  it("reports the totals it was given", () => {
    const text = buildSummary({
      retailer: "coles",
      fileName: "COLES 07-04-2026 13-04-2026.xlsx",
      periodStart: "2026-04-07",
      periodEnd: "2026-04-13",
      totals,
    });
    expect(text).toContain("Coles");
    expect(text).toContain("Orders in window: 7");
    expect(text).toContain("Lines checked: 19");
  });

  it("surfaces a coverage warning prominently", () => {
    const text = buildSummary({
      retailer: "coles",
      fileName: "f.xlsx",
      periodStart: "2026-04-07",
      periodEnd: "2026-04-13",
      totals: { ...totals, ordersTotal: 0, ordersVerified: 0, linesTotal: 0, linesMatched: 0 },
      coverageWarning: "the sync only holds orders from 2026-06-30 onward",
    });
    expect(text).toContain("WARNING:");
    expect(text).toContain("2026-06-30");
  });
});
