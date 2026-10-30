/**
 * Pure half of resolveRules: given the stored rules and the LIVE FreshTrack
 * entities and product catalogue, decide which rules can run. Split out so
 * the decisions are testable without Supabase or GraphQL.
 */
import type { AssignmentRule, RuleAction } from "./matchOrder";

export interface RuleRow {
  id: string;
  // null = any customer (global rule) — migration 00018.
  consignee_entity_code: string | null;
  consignee_freshtrack_id: string | null;
  crop_id: string | null;
  crop_name: string | null;
  // Migration 00024: a rule may target one product instead of a crop.
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  action: RuleAction;
  // null only for a leave_blank rule.
  consignor_entity_code: string | null;
  consignor_freshtrack_id: string | null;
}

export interface InvalidRule {
  rule: RuleRow;
  reason: string;
}

/** The slice of a live FreshTrack entity rule validation needs. */
export interface LiveEntityLite {
  consigneeId: string | null;
  orgName: string | null;
  consignorId: string | null;
  isConsignorActive: boolean;
}

export interface ValidatedRules {
  validRules: AssignmentRule[];
  invalidRules: InvalidRule[];
  // consignee ROLE id -> display name (FreshTrack orgName), for
  // process_actions.consignee_name.
  consigneeNameById: Map<string, string>;
}

/**
 * `liveProductIds` is null when the catalogue was not loaded. A product rule
 * is then rejected rather than trusted — a product deleted in FreshTrack must
 * not keep routing. (resolveRules loads it whenever a product rule exists, and
 * a failed fetch fails the run, as a failed entities fetch always has.)
 */
export function validateRules(
  rows: RuleRow[],
  entities: LiveEntityLite[],
  liveProductIds: Set<string> | null
): ValidatedRules {
  const consignorActiveById = new Map<string, boolean>();
  const consigneeExists = new Set<string>();
  const consigneeNameById = new Map<string, string>();
  for (const e of entities) {
    if (e.consignorId) consignorActiveById.set(e.consignorId, e.isConsignorActive);
    if (e.consigneeId) {
      consigneeExists.add(e.consigneeId);
      if (e.orgName) consigneeNameById.set(e.consigneeId, e.orgName);
    }
  }

  const validRules: AssignmentRule[] = [];
  const invalidRules: InvalidRule[] = [];
  const reject = (rule: RuleRow, reason: string) => invalidRules.push({ rule, reason });

  for (const row of rows) {
    // A global rule (consignee null) has no consignee to validate.
    if (row.consignee_freshtrack_id && !consigneeExists.has(row.consignee_freshtrack_id)) {
      reject(row, `consignee ${row.consignee_entity_code} not found live`);
      continue;
    }

    if (row.product_id) {
      if (!liveProductIds) {
        reject(row, `product ${row.product_code ?? row.product_id} could not be checked — product catalogue unavailable`);
        continue;
      }
      if (!liveProductIds.has(row.product_id)) {
        reject(row, `product ${row.product_code ?? row.product_id} not found live`);
        continue;
      }
    }

    const action: RuleAction = row.action === "leave_blank" ? "leave_blank" : "assign";
    if (action === "assign") {
      if (!row.consignor_freshtrack_id) {
        reject(row, "assign rule has no consignor");
        continue;
      }
      const consignorActive = consignorActiveById.get(row.consignor_freshtrack_id);
      if (consignorActive === undefined) {
        reject(row, `consignor ${row.consignor_entity_code} not found live`);
        continue;
      }
      if (!consignorActive) {
        reject(row, `consignor ${row.consignor_entity_code} is not consignor-active`);
        continue;
      }
    }

    validRules.push({
      id: row.id,
      consigneeFreshtrackId: row.consignee_freshtrack_id,
      cropId: row.crop_id,
      productId: row.product_id,
      action,
      // A leave_blank rule never carries a consignor into matching, whatever
      // the row holds — the DB check forbids one, this is the second lock.
      consignorFreshtrackId: action === "assign" ? row.consignor_freshtrack_id : null,
      consignorEntityCode: action === "assign" ? row.consignor_entity_code : null,
    });
  }

  return { validRules, invalidRules, consigneeNameById };
}
