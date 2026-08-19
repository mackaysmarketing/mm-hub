/**
 * Shared types for the Retailer Price Verification tool.
 *
 * The two retailer extracts look nothing alike — Coles ships a real .xlsx with
 * a start/end date range per row, Woolworths ships an HTML table named .xls
 * with one price column per weekday. Both are normalised to the same
 * `QuoteLine` grain (one article × DC × DAY) so everything downstream —
 * comparison, storage, report — is retailer-agnostic.
 */

export type Retailer = "coles" | "woolworths";

export const TOOL_KEY = "retailer_price_verification";

/** One quoted price for one article, at one DC, on one calendar day. */
export interface QuoteLine {
  retailer: Retailer;
  dcCode: string;
  articleNo: string;
  description: string | null;
  /** ISO yyyy-mm-dd, local (Brisbane) delivery date the price applies to. */
  effectiveOn: string;
  /** null = the quote row carried no price. Not a mismatch — nothing to compare. */
  price: number | null;
  approved: boolean;
  orderMultiple: number | null;
}

/** A row the parser could not use, kept so nothing is lost silently. */
export interface ParseWarning {
  /** 1-based row number in the source sheet, for a human going back to the file. */
  row: number;
  reason: string;
  sample?: string;
}

export interface ParsedQuote {
  retailer: Retailer;
  periodStart: string;
  periodEnd: string;
  lines: QuoteLine[];
  warnings: ParseWarning[];
  /** Source rows read (before per-day expansion). */
  rowCount: number;
  /** Distinct DC codes seen in the file. */
  dcCodes: string[];
}

// --------------------------------------------------------------- comparison

export type LineOutcome =
  | "match"
  | "mismatch"
  | "no_quote"
  | "quote_unpriced"
  | "quote_unapproved"
  | "no_order_price";

export type OrderOutcome =
  | "verified"
  | "mismatch"
  | "no_quote"
  | "partial"
  | "skipped"
  | "unmapped";

/** An order line as it exists in FreshTrack, source-agnostic. */
export interface OrderLineInput {
  lineNo: number | null;
  itemNo: string | null;
  description: string | null;
  quantity: number | null;
  priceValue: number | null;
  pricePer: string | null;
}

/** An order as it exists in FreshTrack, source-agnostic. */
export interface OrderInput {
  orderFtId: string;
  orderNo: string | null;
  stateName: string | null;
  consigneeCode: string | null;
  consigneeName: string | null;
  /** ISO yyyy-mm-dd, Brisbane-local delivery date. */
  deliveryDate: string | null;
  lines: OrderLineInput[];
}

export interface ComparedLine {
  lineNo: number | null;
  itemNo: string | null;
  description: string | null;
  quantity: number | null;
  orderPrice: number | null;
  pricePer: string | null;
  quotePrice: number | null;
  variance: number | null;
  outcome: LineOutcome;
  detail: string | null;
}

export interface ComparedOrder {
  orderFtId: string;
  orderNo: string | null;
  stateName: string | null;
  consigneeCode: string | null;
  consigneeName: string | null;
  dcCode: string | null;
  deliveryDate: string | null;
  outcome: OrderOutcome;
  reason: string | null;
  duplicateGroup: string | null;
  isDuplicate: boolean;
  linesTotal: number;
  linesMatched: number;
  linesMismatched: number;
  linesNoQuote: number;
  lines: ComparedLine[];
}

export interface VerificationSettings {
  /** Absolute dollars. 0 = exact match only. */
  tolerance: number;
  verifiableStates: string[];
  skipStates: string[];
  /** How to treat a priced-but-unapproved quote row. */
  unapprovedQuotes: "use" | "skip";
}

export const DEFAULT_SETTINGS: VerificationSettings = {
  tolerance: 0,
  verifiableStates: [
    "Ordered",
    "Filled",
    "Shipped",
    "Ready to Invoice",
    "Invoiced",
  ],
  skipStates: ["Cancelled"],
  unapprovedQuotes: "use",
};

/**
 * The six order buckets partition `ordersTotal` exactly — every order in the
 * window is in one and only one — so a report's totals always reconcile.
 * `ordersDuplicate` is a cross-cutting flag on top of those buckets, not a
 * seventh bucket, and is deliberately NOT part of the sum.
 */
export interface VerificationTotals {
  ordersTotal: number;
  ordersVerified: number;
  ordersMismatched: number;
  ordersPartial: number;
  ordersNoQuote: number;
  ordersSkipped: number;
  ordersUnmapped: number;
  ordersDuplicate: number;
  linesTotal: number;
  linesMatched: number;
  linesMismatched: number;
  linesNoQuote: number;
}

export interface VerificationResult {
  orders: ComparedOrder[];
  totals: VerificationTotals;
}

/** DC → consignee entity mapping, including the alt (avocado) variants. */
export interface DcMapping {
  retailer: Retailer;
  dcCode: string;
  dcLabel: string | null;
  /** null = known DC with no confirmed FreshTrack entity. */
  entityCode: string | null;
  altEntityCodes: string[];
  active: boolean;
  notes: string | null;
}
