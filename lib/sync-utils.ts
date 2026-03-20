// ---------------------------------------------------------------------------
// Shared sync utilities — used by the FreshTrack cron handler
// ---------------------------------------------------------------------------

export interface SyncStepResult {
  step: number;
  sourceView: string;
  targetTable: string;
  recordsSynced: number;
  error?: string;
}

/** Extract weight in kg from a product name string, e.g. "Banana 13kg Carton" → 13 */
export function extractWeightKg(productName: string): number {
  const match = productName.match(/(\d+(?:\.\d+)?)\s*kg/i);
  return match ? parseFloat(match[1]) : 15;
}

/** Derive produce category from product name / variety via keyword matching */
export function deriveProduceCategory(
  productName: string,
  variety?: string
): string {
  const text = `${productName} ${variety ?? ""}`.toLowerCase();

  if (text.includes("frozen banana") || text.includes("frozen ban"))
    return "Frozen Banana";
  if (text.includes("banana") || text.includes("ban ")) return "Banana";
  if (text.includes("avocado") || text.includes("avo ")) return "Avocado";
  if (text.includes("papaya") || text.includes("pawpaw")) return "Papaya";
  if (text.includes("passionfruit") || text.includes("passion fruit"))
    return "Passionfruit";
  return "Other";
}

/** Split an array into chunks of `size` */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Apply field_mapping to transform a FreshTrack source row into target columns.
 * For each key in fieldMapping, reads sourceRow[key] and writes to result[fieldMapping[key]].
 * Skips if the source field is missing from the row.
 */
export function mapSourceRow(
  sourceRow: Record<string, unknown>,
  fieldMapping: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [sourceCol, targetCol] of Object.entries(fieldMapping)) {
    if (sourceCol in sourceRow) {
      result[targetCol] = sourceRow[sourceCol];
    }
  }
  return result;
}

/**
 * Apply transform_rules to a mapped row.
 * Supported transforms:
 *   "extract_from_product_name"          → extractWeightKg(product_name)
 *   "calculate_from_quantity_and_product" → quantity * extractWeightKg(product_name)
 *   "derive_from_product"                → deriveProduceCategory(product_name)
 */
export function applyTransforms(
  row: Record<string, unknown>,
  transformRules: Record<string, string>
): Record<string, unknown> {
  const productName = String(row.product_name ?? "");

  for (const [targetField, transform] of Object.entries(transformRules)) {
    switch (transform) {
      case "extract_from_product_name":
        row[targetField] = extractWeightKg(productName);
        break;
      case "calculate_from_quantity_and_product":
        row[targetField] =
          (Number(row.quantity) || 0) * extractWeightKg(productName);
        break;
      case "derive_from_product":
        row[targetField] = deriveProduceCategory(productName);
        break;
    }
  }
  return row;
}
