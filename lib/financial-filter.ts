/**
 * Financial data filtering — strips monetary values from API responses
 * when user lacks financial_access for a given page.
 *
 * Replaces values with null (not 0) so the UI can distinguish "hidden" from "zero".
 */

const FINANCIAL_FIELD_NAMES = new Set([
  "unit_price",
  "total_amount",
  "total_gross",
  "total_deductions",
  "total_invoiced",
  "total_deductions_ex_gst",
  "total_deductions_gst",
  "freight_cost",
  "amount",
  "gst",
  "ex_gst",
  "avg_price",
  "price_per_kg",
  "avgPrice",
  "totalAmount",
  "totalGross",
  "totalDeductions",
  "totalInvoiced",
  "unitPrice",
  "pricePerKg",
  "freightCost",
  "avgPricePerKg",
  "grossSales",
  "priceRange",
]);

const FINANCIAL_PATTERNS = [
  "price",
  "amount",
  "cost",
  "gross",
  "invoiced",
  "deduction",
];

function isFinancialKey(key: string): boolean {
  if (FINANCIAL_FIELD_NAMES.has(key)) return true;
  const lower = key.toLowerCase();
  return FINANCIAL_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively strip financial data from an object or array.
 * Financial field values are replaced with null.
 */
export function stripFinancials<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => stripFinancials(item)) as T;
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (isFinancialKey(key)) {
        // For nested objects like { value: number, change: number }, null the whole thing
        if (typeof value === "object" && value !== null && "value" in value) {
          result[key] = { ...value, value: null };
        } else {
          result[key] = null;
        }
      } else if (typeof value === "object" && value !== null) {
        result[key] = stripFinancials(value);
      } else {
        result[key] = value;
      }
    }
    return result as T;
  }

  return data;
}

/**
 * Map API route paths to menu item names for financial_access lookup.
 */
const PAGE_NAME_MAP: Record<string, string> = {
  dashboard: "Dashboard",
  sales: "Sales & Pricing",
  remittances: "Remittances",
};

export function getPageNameFromPath(pathname: string): string | null {
  for (const [key, name] of Object.entries(PAGE_NAME_MAP)) {
    if (pathname.includes(`/api/${key}`)) return name;
  }
  return null;
}
