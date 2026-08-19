/**
 * The comparison engine. Pure: orders in, verdicts out, no I/O.
 *
 * Keeping this free of both Supabase and GraphQL is what lets the same logic
 * serve the app (which reads the synced Postgres tables) and the historical
 * backtest script (which walks live GraphQL for windows predating the sync).
 * One implementation, so the two can never disagree about what "verified"
 * means.
 *
 * RULES
 *  - Join key is the retailer article code: ft_order_items.item_no === the
 *    Coles `Product` / Woolworths `Article #`. Exact string match; the codes
 *    are the same identifier on both sides, so there is nothing to fuzzy-match.
 *  - The quote is looked up per DAY, keyed on the order's own delivery date,
 *    not on "somewhere in the quote week". A Woolworths price that changes
 *    mid-week is then honoured rather than averaged away.
 *  - An order is `verified` only when EVERY line matched. One bad line means
 *    the order is not verified — that is the whole point of the tool.
 *  - Missing data is never a mismatch. No quote row, an unpriced quote row, or
 *    an order line with no price each get their own outcome, because "we could
 *    not check this" and "this is wrong" must not be confused in a report
 *    someone will act on.
 */
import type {
  ComparedLine,
  ComparedOrder,
  DcMapping,
  LineOutcome,
  OrderInput,
  OrderOutcome,
  QuoteLine,
  VerificationResult,
  VerificationSettings,
  VerificationTotals,
} from "./types";

/** Quote lookup keyed `dcCode|articleNo|date`. */
export type QuoteIndex = Map<string, QuoteLine>;

export function buildQuoteIndex(lines: QuoteLine[]): QuoteIndex {
  const index: QuoteIndex = new Map();
  for (const l of lines) {
    index.set(quoteKey(l.dcCode, l.articleNo, l.effectiveOn), l);
  }
  return index;
}

function quoteKey(dc: string, article: string, date: string): string {
  return `${dc}|${article}|${date}`;
}

/** consignee entity code → DC code, including the avocado-variant entities. */
export function buildConsigneeIndex(mappings: DcMapping[]): Map<string, DcMapping> {
  const index = new Map<string, DcMapping>();
  for (const m of mappings) {
    if (!m.active) continue;
    if (m.entityCode) index.set(m.entityCode.toUpperCase(), m);
    for (const alt of m.altEntityCodes) index.set(alt.toUpperCase(), m);
  }
  return index;
}

export function compareOrders(
  orders: OrderInput[],
  quotes: QuoteIndex,
  mappings: DcMapping[],
  settings: VerificationSettings
): VerificationResult {
  const byConsignee = buildConsigneeIndex(mappings);
  const compared = orders.map((o) => compareOrder(o, quotes, byConsignee, settings));
  flagDuplicates(compared);
  return { orders: compared, totals: tally(compared) };
}

function compareOrder(
  order: OrderInput,
  quotes: QuoteIndex,
  byConsignee: Map<string, DcMapping>,
  settings: VerificationSettings
): ComparedOrder {
  const mapping = order.consigneeCode
    ? byConsignee.get(order.consigneeCode.toUpperCase())
    : undefined;

  const base = {
    orderFtId: order.orderFtId,
    orderNo: order.orderNo,
    stateName: order.stateName,
    consigneeCode: order.consigneeCode,
    consigneeName: order.consigneeName,
    dcCode: mapping?.dcCode ?? null,
    deliveryDate: order.deliveryDate,
    duplicateGroup: null as string | null,
    isDuplicate: false,
  };

  const state = order.stateName ?? "";

  // Explicitly skipped states (Cancelled) — listed in the report with a
  // reason rather than filtered out, so every order in the window is
  // accounted for exactly once.
  if (settings.skipStates.includes(state)) {
    return emptyOrder(base, "skipped", `order state "${state}" is excluded`);
  }

  // Any state that is neither verifiable nor explicitly skipped is flagged,
  // not judged. "WWG- Load Moved" is the live example: real orders, but nobody
  // has decided whether their prices are final.
  if (!settings.verifiableStates.includes(state)) {
    return emptyOrder(
      base,
      "skipped",
      `order state "${state || "(none)"}" is not in the verifiable list`
    );
  }

  if (!mapping || !mapping.entityCode) {
    return emptyOrder(
      base,
      "unmapped",
      mapping
        ? `DC ${mapping.dcCode} has no FreshTrack entity mapping`
        : `consignee ${order.consigneeCode ?? "(none)"} is not mapped to a quote DC`
    );
  }

  if (!order.deliveryDate) {
    return emptyOrder(base, "skipped", "order has no scheduled delivery date");
  }

  const lines: ComparedLine[] = order.lines.map((line) =>
    compareLine(line, mapping.dcCode, order.deliveryDate!, quotes, settings)
  );

  const matched = lines.filter((l) => l.outcome === "match").length;
  const mismatched = lines.filter((l) => l.outcome === "mismatch").length;
  const unusable = lines.filter(
    (l) => l.outcome !== "match" && l.outcome !== "mismatch"
  ).length;

  let outcome: OrderOutcome;
  let reason: string | null = null;
  if (lines.length === 0) {
    outcome = "no_quote";
    reason = "order has no lines";
  } else if (mismatched > 0) {
    outcome = "mismatch";
    reason = `${mismatched} of ${lines.length} line(s) differ from the quote`;
  } else if (matched === lines.length) {
    outcome = "verified";
  } else if (matched > 0) {
    outcome = "partial";
    reason = `${matched} line(s) matched, ${unusable} could not be checked`;
  } else {
    outcome = "no_quote";
    reason = describeUnusable(lines);
  }

  return {
    ...base,
    outcome,
    reason,
    linesTotal: lines.length,
    linesMatched: matched,
    linesMismatched: mismatched,
    linesNoQuote: unusable,
    lines,
  };
}

function compareLine(
  line: { lineNo: number | null; itemNo: string | null; description: string | null; quantity: number | null; priceValue: number | null; pricePer: string | null },
  dcCode: string,
  deliveryDate: string,
  quotes: QuoteIndex,
  settings: VerificationSettings
): ComparedLine {
  const shell = {
    lineNo: line.lineNo,
    itemNo: line.itemNo,
    description: line.description,
    quantity: line.quantity,
    orderPrice: line.priceValue,
    pricePer: line.pricePer,
    quotePrice: null as number | null,
    variance: null as number | null,
  };

  if (!line.itemNo) {
    return { ...shell, outcome: "no_quote", detail: "order line has no item number" };
  }

  const quote = quotes.get(quoteKey(dcCode, line.itemNo, deliveryDate));
  if (!quote) {
    return {
      ...shell,
      outcome: "no_quote",
      detail: `no quote row for article ${line.itemNo} at ${dcCode} on ${deliveryDate}`,
    };
  }

  // ft_order_items carries no description, so the report borrows the retailer's
  // own wording from the quote row. That is the label the buyer would recognise.
  shell.description = shell.description ?? quote.description;

  if (!quote.approved && settings.unapprovedQuotes === "skip") {
    return {
      ...shell,
      quotePrice: quote.price,
      outcome: "quote_unapproved",
      detail: "quote row is not approved and the run is set to skip those",
    };
  }

  if (quote.price === null) {
    return {
      ...shell,
      outcome: "quote_unpriced",
      detail: "quote row carries no price — nothing to compare against",
    };
  }

  if (line.priceValue === null) {
    return {
      ...shell,
      quotePrice: quote.price,
      outcome: "no_order_price",
      detail: "order line carries no price",
    };
  }

  const variance = round4(line.priceValue - quote.price);
  const withinTolerance = Math.abs(variance) <= settings.tolerance + EPSILON;
  const unapprovedNote = quote.approved ? "" : " (quote row not approved)";

  const outcome: LineOutcome = withinTolerance ? "match" : "mismatch";
  return {
    ...shell,
    quotePrice: quote.price,
    variance,
    outcome,
    detail: withinTolerance
      ? unapprovedNote.trim() || null
      : `order $${line.priceValue.toFixed(2)} vs quote $${quote.price.toFixed(2)}` +
        ` (${variance > 0 ? "+" : ""}$${variance.toFixed(2)})${unapprovedNote}`,
  };
}

/**
 * Says WHY nothing on an order could be checked. The distinction matters in
 * practice: most FreshTrack orders carry no line price until they reach
 * Invoiced (only ~26% of Ordered lines have one, against ~90% of Invoiced),
 * so "the order has no prices yet" is the common case and is a completely
 * different message to "we hold no quote for these products".
 */
function describeUnusable(lines: ComparedLine[]): string {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.outcome, (counts.get(l.outcome) ?? 0) + 1);

  if (counts.get("no_order_price") === lines.length) {
    return "no line on this order carries a price yet — nothing to verify";
  }
  if (counts.get("no_quote") === lines.length) {
    return "no line on this order matched a quote row";
  }
  if (counts.get("quote_unpriced") === lines.length) {
    return "the quote carries no price for any line on this order";
  }
  if (counts.get("quote_unapproved") === lines.length) {
    return "every matching quote row is unapproved and the run skips those";
  }
  return "no line on this order could be checked against the quote";
}

/**
 * Floating-point guard so a tolerance of exactly 0 still matches 42.69 against
 * 42.69. Prices arrive as JS numbers from both a spreadsheet and a numeric
 * Postgres column, and those two paths do not always produce bit-identical
 * values. A hundredth of a cent is far below anything that could be a real
 * pricing difference.
 */
const EPSILON = 1e-6;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Flags parallel order series — Coles Melbourne runs the same dates in
 * "Ordered" and "Invoiced" at once, which looks like an EDI re-import. Grouped
 * on consignee + delivery date + an order-independent signature of the lines.
 * The FIRST member of each group (by order number) stays unflagged so a reader
 * knows which one to treat as canonical; the rest are flagged. Every member is
 * still reported.
 */
function flagDuplicates(orders: ComparedOrder[]): void {
  const groups = new Map<string, ComparedOrder[]>();

  for (const o of orders) {
    if (o.outcome === "skipped" || o.outcome === "unmapped") continue;
    if (!o.consigneeCode || !o.deliveryDate || o.lines.length === 0) continue;

    const signature = o.lines
      .map((l) => `${l.itemNo ?? "?"}:${l.quantity ?? "?"}:${l.orderPrice ?? "?"}`)
      .sort()
      .join(",");
    const key = `${o.consigneeCode}|${o.deliveryDate}|${signature}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(o);
    else groups.set(key, [o]);
  }

  for (const [key, members] of Array.from(groups.entries())) {
    if (members.length < 2) continue;
    members.sort((a, b) => (a.orderNo ?? "").localeCompare(b.orderNo ?? ""));
    members.forEach((m, i) => {
      m.duplicateGroup = shortKey(key);
      m.isDuplicate = i > 0;
    });
  }
}

function shortKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `dup-${(hash >>> 0).toString(36)}`;
}

function tally(orders: ComparedOrder[]): VerificationTotals {
  const t: VerificationTotals = {
    ordersTotal: orders.length,
    ordersVerified: 0,
    ordersMismatched: 0,
    ordersPartial: 0,
    ordersNoQuote: 0,
    ordersSkipped: 0,
    ordersUnmapped: 0,
    ordersDuplicate: 0,
    linesTotal: 0,
    linesMatched: 0,
    linesMismatched: 0,
    linesNoQuote: 0,
  };

  for (const o of orders) {
    switch (o.outcome) {
      case "verified": t.ordersVerified++; break;
      case "mismatch": t.ordersMismatched++; break;
      case "partial": t.ordersPartial++; break;
      case "no_quote": t.ordersNoQuote++; break;
      case "skipped": t.ordersSkipped++; break;
      case "unmapped": t.ordersUnmapped++; break;
    }
    if (o.isDuplicate) t.ordersDuplicate++;
    t.linesTotal += o.linesTotal;
    t.linesMatched += o.linesMatched;
    t.linesMismatched += o.linesMismatched;
    t.linesNoQuote += o.linesNoQuote;
  }

  return t;
}

function emptyOrder(
  base: Omit<ComparedOrder, "outcome" | "reason" | "linesTotal" | "linesMatched" | "linesMismatched" | "linesNoQuote" | "lines">,
  outcome: OrderOutcome,
  reason: string
): ComparedOrder {
  return {
    ...base,
    outcome,
    reason,
    linesTotal: 0,
    linesMatched: 0,
    linesMismatched: 0,
    linesNoQuote: 0,
    lines: [],
  };
}
