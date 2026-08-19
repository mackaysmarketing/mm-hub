/**
 * Report rendering: the per-line CSV and the human-readable summary.
 *
 * REPORT INTEGRITY IS THE POINT
 *   Every order in the window appears exactly once, including the ones that
 *   were skipped and the ones with no quote coverage. An order with no lines
 *   (cancelled, unmapped, state not verifiable) still gets one CSV row so it
 *   cannot be quietly absent — a report that omits what it could not check
 *   reads as a clean bill of health.
 */
import type { ComparedOrder, VerificationTotals } from "./types";

const COLUMNS = [
  "Order No",
  "Order State",
  "Consignee Code",
  "Consignee",
  "DC Code",
  "Delivery Date",
  "Order Outcome",
  "Order Note",
  "Duplicate",
  "Line No",
  "Item No",
  "Description",
  "Quantity",
  "Order Price",
  "Price Per",
  "Quote Price",
  "Variance",
  "Line Outcome",
  "Line Detail",
] as const;

export function buildCsv(orders: ComparedOrder[]): string {
  const rows: string[] = [COLUMNS.join(",")];

  for (const order of orders) {
    const orderCells = [
      order.orderNo ?? "",
      order.stateName ?? "",
      order.consigneeCode ?? "",
      order.consigneeName ?? "",
      order.dcCode ?? "",
      order.deliveryDate ?? "",
      order.outcome,
      order.reason ?? "",
      order.isDuplicate ? `duplicate of ${order.duplicateGroup}` : order.duplicateGroup ?? "",
    ];

    if (order.lines.length === 0) {
      // Still one row, so the order is present and its reason is readable.
      rows.push(csvRow([...orderCells, "", "", "", "", "", "", "", "", "", ""]));
      continue;
    }

    for (const line of order.lines) {
      rows.push(
        csvRow([
          ...orderCells,
          line.lineNo ?? "",
          line.itemNo ?? "",
          line.description ?? "",
          line.quantity ?? "",
          line.orderPrice ?? "",
          line.pricePer ?? "",
          line.quotePrice ?? "",
          line.variance ?? "",
          line.outcome,
          line.detail ?? "",
        ])
      );
    }
  }

  return rows.join("\r\n");
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Quotes anything that could break a cell boundary. The leading-character
 * guard stops Excel from evaluating a description beginning with =, +, - or @
 * as a formula when someone opens the report.
 */
function csvCell(value: string | number): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface SummaryInput {
  retailer: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  totals: VerificationTotals;
  coverageWarning?: string | null;
}

/** Plain-text summary for the UI header and any future emailed report. */
export function buildSummary(input: SummaryInput): string {
  const t = input.totals;
  const lines = [
    `Retailer price verification — ${titleCase(input.retailer)}`,
    `Quote: ${input.fileName} (${input.periodStart} to ${input.periodEnd})`,
    "",
    `Orders in window: ${t.ordersTotal}`,
    `  verified (every line matched): ${t.ordersVerified}`,
    `  mismatched:                    ${t.ordersMismatched}`,
    `  partially checked:             ${t.ordersPartial}`,
    `  no usable quote:               ${t.ordersNoQuote}`,
    `  skipped (state):               ${t.ordersSkipped}`,
    `  DC not mapped:                 ${t.ordersUnmapped}`,
    "",
    `Lines checked: ${t.linesTotal}`,
    `  matched:      ${t.linesMatched}`,
    `  mismatched:   ${t.linesMismatched}`,
    `  not checkable: ${t.linesNoQuote}`,
  ];

  if (t.ordersDuplicate > 0) {
    lines.push(
      "",
      `${t.ordersDuplicate} order(s) flagged as duplicates of an earlier order ` +
        `in the same group — counted once each, listed in full.`
    );
  }
  if (input.coverageWarning) {
    lines.push("", `WARNING: ${input.coverageWarning}`);
  }

  return lines.join("\n");
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Filename for a downloaded report. */
export function reportFileName(retailer: string, periodStart: string, periodEnd: string): string {
  return `price-verification-${retailer}-${periodStart}-to-${periodEnd}.csv`;
}
