import { describe, it, expect } from "vitest";
import { buildQuoteIndex, compareOrders } from "./compare";
import {
  DEFAULT_SETTINGS,
  type DcMapping,
  type OrderInput,
  type QuoteLine,
  type VerificationSettings,
} from "./types";

// --------------------------------------------------------------- fixtures

const MAPPINGS: DcMapping[] = [
  {
    retailer: "coles",
    dcCode: "BRI9415",
    dcLabel: "Coles Parkinson",
    entityCode: "COLBR",
    altEntityCodes: [],
    active: true,
    notes: null,
  },
  {
    retailer: "coles",
    dcCode: "DPO9745",
    dcLabel: null,
    entityCode: null, // known DC, deliberately unmapped
    altEntityCodes: [],
    active: true,
    notes: null,
  },
  {
    retailer: "woolworths",
    dcCode: "2986",
    dcLabel: "Brisbane RDC",
    entityCode: "WOWBR",
    altEntityCodes: ["WWBRA"],
    active: true,
    notes: null,
  },
];

function quote(
  dcCode: string,
  articleNo: string,
  price: number | null,
  opts: { approved?: boolean; date?: string } = {}
): QuoteLine {
  return {
    retailer: "coles",
    dcCode,
    articleNo,
    description: `DESC ${articleNo}`,
    effectiveOn: opts.date ?? "2026-04-08",
    price,
    approved: opts.approved ?? true,
    orderMultiple: 12,
  };
}

function order(
  orderNo: string,
  lines: { itemNo: string; price: number | null }[],
  opts: {
    state?: string;
    consignee?: string;
    date?: string | null;
  } = {}
): OrderInput {
  return {
    orderFtId: `ft-${orderNo}`,
    orderNo,
    stateName: opts.state ?? "Ordered",
    consigneeCode: opts.consignee ?? "COLBR",
    consigneeName: "Coles Parkinson",
    deliveryDate: opts.date === undefined ? "2026-04-08" : opts.date,
    lines: lines.map((l, i) => ({
      lineNo: i + 1,
      itemNo: l.itemNo,
      description: null,
      quantity: 10,
      priceValue: l.price,
      pricePer: "BOX",
    })),
  };
}

function run(
  orders: OrderInput[],
  quotes: QuoteLine[],
  settings: Partial<VerificationSettings> = {}
) {
  return compareOrders(orders, buildQuoteIndex(quotes), MAPPINGS, {
    ...DEFAULT_SETTINGS,
    ...settings,
  });
}

// ======================================================= line outcomes

describe("line comparison", () => {
  it("matches an exact price", () => {
    const r = run([order("1", [{ itemNo: "A", price: 42 }])], [quote("BRI9415", "A", 42)]);
    expect(r.orders[0]!.lines[0]!.outcome).toBe("match");
    expect(r.orders[0]!.lines[0]!.variance).toBe(0);
    expect(r.orders[0]!.outcome).toBe("verified");
  });

  it("matches despite floating-point representation at zero tolerance", () => {
    const r = run([order("1", [{ itemNo: "A", price: 0.1 + 0.2 }])], [quote("BRI9415", "A", 0.3)]);
    expect(r.orders[0]!.lines[0]!.outcome).toBe("match");
  });

  it("flags a price difference as a mismatch and reports the variance", () => {
    const r = run([order("1", [{ itemNo: "A", price: 43 }])], [quote("BRI9415", "A", 42)]);
    const line = r.orders[0]!.lines[0]!;
    expect(line.outcome).toBe("mismatch");
    expect(line.variance).toBe(1);
    expect(line.detail).toContain("$43.00");
    expect(line.detail).toContain("$42.00");
  });

  it("honours a tolerance", () => {
    const within = run(
      [order("1", [{ itemNo: "A", price: 42.01 }])],
      [quote("BRI9415", "A", 42)],
      { tolerance: 0.01 }
    );
    expect(within.orders[0]!.lines[0]!.outcome).toBe("match");

    const outside = run(
      [order("1", [{ itemNo: "A", price: 42.02 }])],
      [quote("BRI9415", "A", 42)],
      { tolerance: 0.01 }
    );
    expect(outside.orders[0]!.lines[0]!.outcome).toBe("mismatch");
  });

  it("reports a missing quote row as no_quote, never as a mismatch", () => {
    const r = run([order("1", [{ itemNo: "ZZZ", price: 42 }])], [quote("BRI9415", "A", 42)]);
    expect(r.orders[0]!.lines[0]!.outcome).toBe("no_quote");
    expect(r.totals.linesMismatched).toBe(0);
  });

  it("reports an unpriced quote row as quote_unpriced, never as a mismatch", () => {
    const r = run([order("1", [{ itemNo: "A", price: 42 }])], [quote("BRI9415", "A", null)]);
    expect(r.orders[0]!.lines[0]!.outcome).toBe("quote_unpriced");
    expect(r.totals.linesMismatched).toBe(0);
  });

  it("reports an order line with no price as no_order_price", () => {
    const r = run([order("1", [{ itemNo: "A", price: null }])], [quote("BRI9415", "A", 42)]);
    expect(r.orders[0]!.lines[0]!.outcome).toBe("no_order_price");
    expect(r.totals.linesMismatched).toBe(0);
  });

  it("only matches the quote for the order's own delivery date", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { date: "2026-04-09" })],
      [quote("BRI9415", "A", 42, { date: "2026-04-08" })]
    );
    expect(r.orders[0]!.lines[0]!.outcome).toBe("no_quote");
  });

  it("uses the per-day price when a week's prices differ", () => {
    const quotes = [
      quote("BRI9415", "A", 40, { date: "2026-04-08" }),
      quote("BRI9415", "A", 45, { date: "2026-04-09" }),
    ];
    const r = run(
      [
        order("1", [{ itemNo: "A", price: 40 }], { date: "2026-04-08" }),
        order("2", [{ itemNo: "A", price: 45 }], { date: "2026-04-09" }),
      ],
      quotes
    );
    expect(r.orders.map((o) => o.outcome)).toEqual(["verified", "verified"]);
  });

  it("borrows the quote's description when the order line has none", () => {
    const r = run([order("1", [{ itemNo: "A", price: 42 }])], [quote("BRI9415", "A", 42)]);
    expect(r.orders[0]!.lines[0]!.description).toBe("DESC A");
  });
});

// ========================================== unapproved quote handling

describe("unapproved quote rows", () => {
  const quotes = [quote("BRI9415", "A", 42, { approved: false })];

  it('compares against them under "use" and notes it', () => {
    const r = run([order("1", [{ itemNo: "A", price: 42 }])], quotes, {
      unapprovedQuotes: "use",
    });
    expect(r.orders[0]!.lines[0]!.outcome).toBe("match");
    expect(r.orders[0]!.outcome).toBe("verified");
    expect(r.orders[0]!.lines[0]!.detail).toContain("not approved");
  });

  it('treats them as unusable under "skip"', () => {
    const r = run([order("1", [{ itemNo: "A", price: 42 }])], quotes, {
      unapprovedQuotes: "skip",
    });
    expect(r.orders[0]!.lines[0]!.outcome).toBe("quote_unapproved");
    expect(r.orders[0]!.outcome).toBe("no_quote");
  });

  it("still flags a genuine price difference on an unapproved row", () => {
    const r = run([order("1", [{ itemNo: "A", price: 50 }])], quotes, {
      unapprovedQuotes: "use",
    });
    expect(r.orders[0]!.lines[0]!.outcome).toBe("mismatch");
  });
});

// ====================================================== order rollup

describe("order rollup", () => {
  it("verifies only when every line matched", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }, { itemNo: "B", price: 18 }])],
      [quote("BRI9415", "A", 42), quote("BRI9415", "B", 18)]
    );
    expect(r.orders[0]!.outcome).toBe("verified");
    expect(r.orders[0]!.linesMatched).toBe(2);
  });

  it("refuses to verify an order where one line differs", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }, { itemNo: "B", price: 99 }])],
      [quote("BRI9415", "A", 42), quote("BRI9415", "B", 18)]
    );
    expect(r.orders[0]!.outcome).toBe("mismatch");
    expect(r.orders[0]!.linesMatched).toBe(1);
    expect(r.orders[0]!.linesMismatched).toBe(1);
  });

  it("marks an order partial when some lines could not be checked", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }, { itemNo: "ZZZ", price: 5 }])],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("partial");
    expect(r.orders[0]!.linesNoQuote).toBe(1);
  });

  it("marks an order no_quote when nothing on it could be checked", () => {
    const r = run([order("1", [{ itemNo: "ZZZ", price: 5 }])], [quote("BRI9415", "A", 42)]);
    expect(r.orders[0]!.outcome).toBe("no_quote");
  });

  it("mismatch beats partial when both are present", () => {
    const r = run(
      [
        order("1", [
          { itemNo: "A", price: 99 },
          { itemNo: "ZZZ", price: 5 },
        ]),
      ],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("mismatch");
  });
});

// ======================================================= state rules

describe("order state handling", () => {
  it("skips a cancelled order but still reports it", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { state: "Cancelled" })],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]!.outcome).toBe("skipped");
    expect(r.orders[0]!.reason).toContain("Cancelled");
    expect(r.totals.ordersSkipped).toBe(1);
  });

  it("flags an unknown state rather than judging it", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { state: "WWG- Load Moved" })],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("skipped");
    expect(r.orders[0]!.reason).toContain("WWG- Load Moved");
  });

  it("verifies every state on the verifiable list", () => {
    const quotes = [quote("BRI9415", "A", 42)];
    for (const state of DEFAULT_SETTINGS.verifiableStates) {
      const r = run([order("1", [{ itemNo: "A", price: 42 }], { state })], quotes);
      expect(r.orders[0]!.outcome, state).toBe("verified");
    }
  });

  it("skips an order with no delivery date", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { date: null })],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("skipped");
    expect(r.orders[0]!.reason).toContain("no scheduled delivery date");
  });
});

// ===================================================== DC mapping

describe("consignee mapping", () => {
  it("reports an order on an unmapped DC rather than dropping it", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { consignee: "COLXX" })],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("unmapped");
    expect(r.totals.ordersUnmapped).toBe(1);
  });

  it("accepts the avocado-variant consignee for the parent DC", () => {
    const r = compareOrders(
      [order("1", [{ itemNo: "A", price: 42 }], { consignee: "WWBRA" })],
      buildQuoteIndex([{ ...quote("2986", "A", 42), retailer: "woolworths" }]),
      MAPPINGS,
      DEFAULT_SETTINGS
    );
    expect(r.orders[0]!.dcCode).toBe("2986");
    expect(r.orders[0]!.outcome).toBe("verified");
  });

  it("matches the consignee code case-insensitively", () => {
    const r = run(
      [order("1", [{ itemNo: "A", price: 42 }], { consignee: "colbr" })],
      [quote("BRI9415", "A", 42)]
    );
    expect(r.orders[0]!.outcome).toBe("verified");
  });
});

// ======================================================= duplicates

describe("duplicate order series", () => {
  it("flags the later members of an identical parallel series", () => {
    const lines = [{ itemNo: "A", price: 42 }];
    const r = run(
      [
        order("5000001", lines, { state: "Ordered" }),
        order("5000002", lines, { state: "Invoiced" }),
      ],
      [quote("BRI9415", "A", 42)]
    );

    expect(r.orders[0]!.isDuplicate).toBe(false);
    expect(r.orders[1]!.isDuplicate).toBe(true);
    expect(r.orders[0]!.duplicateGroup).toBe(r.orders[1]!.duplicateGroup);
    expect(r.totals.ordersDuplicate).toBe(1);
    // Both are still reported and still counted in their outcome buckets.
    expect(r.totals.ordersTotal).toBe(2);
    expect(r.totals.ordersVerified).toBe(2);
  });

  it("does not flag orders that merely share a date", () => {
    const r = run(
      [
        order("5000001", [{ itemNo: "A", price: 42 }]),
        order("5000002", [{ itemNo: "B", price: 18 }]),
      ],
      [quote("BRI9415", "A", 42), quote("BRI9415", "B", 18)]
    );
    expect(r.totals.ordersDuplicate).toBe(0);
  });
});

// ========================================================== totals

describe("totals", () => {
  it("partitions every order into exactly one bucket", () => {
    const quotes = [quote("BRI9415", "A", 42), quote("BRI9415", "B", 18)];
    const r = run(
      [
        order("1", [{ itemNo: "A", price: 42 }]),                          // verified
        order("2", [{ itemNo: "A", price: 99 }]),                          // mismatch
        order("3", [{ itemNo: "A", price: 42 }, { itemNo: "ZZ", price: 1 }]), // partial
        order("4", [{ itemNo: "ZZ", price: 1 }]),                          // no_quote
        order("5", [{ itemNo: "A", price: 42 }], { state: "Cancelled" }),  // skipped
        order("6", [{ itemNo: "A", price: 42 }], { consignee: "NOPE" }),   // unmapped
      ],
      quotes
    );

    const t = r.totals;
    expect(t.ordersTotal).toBe(6);
    expect(
      t.ordersVerified + t.ordersMismatched + t.ordersPartial +
        t.ordersNoQuote + t.ordersSkipped + t.ordersUnmapped
    ).toBe(t.ordersTotal);
    expect(t).toMatchObject({
      ordersVerified: 1,
      ordersMismatched: 1,
      ordersPartial: 1,
      ordersNoQuote: 1,
      ordersSkipped: 1,
      ordersUnmapped: 1,
    });
  });

  it("line totals reconcile against the per-order counts", () => {
    const r = run(
      [
        order("1", [{ itemNo: "A", price: 42 }, { itemNo: "B", price: 99 }]),
        order("2", [{ itemNo: "ZZ", price: 1 }]),
      ],
      [quote("BRI9415", "A", 42), quote("BRI9415", "B", 18)]
    );
    const t = r.totals;
    expect(t.linesTotal).toBe(3);
    expect(t.linesMatched + t.linesMismatched + t.linesNoQuote).toBe(t.linesTotal);
  });

  it("handles an empty order set without dividing by zero", () => {
    const r = run([], [quote("BRI9415", "A", 42)]);
    expect(r.orders).toHaveLength(0);
    expect(r.totals.ordersTotal).toBe(0);
  });
});
