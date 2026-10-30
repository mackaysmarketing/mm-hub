/**
 * Loads active rules from Supabase and validates them against LIVE
 * FreshTrack — never against `ft_entities`, which is known-stale (design doc
 * §3.6: missing at least SQBRL as of 2026-07-30) and would fail this process
 * on exactly the customers that need it most.
 *
 * Uses Q_ENTITIES_FOR_RULE_VALIDATION (no filterIsActive) rather than the
 * sync layer's Q_ENTITIES_FULL, since that query's isActive filter is a
 * different flag than isConsignorActive and could in principle hide a valid
 * consignor role behind an unrelated entity-level flag.
 *
 * The product catalogue is fetched only when at least one rule targets a
 * product (migration 00024), so a rule set with none costs nothing extra.
 * The decisions themselves live in validateRules.ts.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FOR_RULE_VALIDATION,
  Q_PRODUCTS_ALL,
  type RspEntities,
  type RspProducts,
} from "@/lib/freshtrack/queries";
import { validateRules, type RuleRow, type ValidatedRules } from "./validateRules";

export type { RuleRow, InvalidRule } from "./validateRules";
export type ResolvedRules = ValidatedRules;

const ENTITY_FETCH_LIMIT = 1000;

export const RULE_SELECT =
  "id, consignee_entity_code, consignee_freshtrack_id, crop_id, crop_name, product_id, product_code, product_name, action, consignor_entity_code, consignor_freshtrack_id";
/** The columns before migration 00024. */
const LEGACY_RULE_SELECT =
  "id, consignee_entity_code, consignee_freshtrack_id, crop_id, crop_name, consignor_entity_code, consignor_freshtrack_id";
/** Postgres "undefined column". */
const UNDEFINED_COLUMN = "42703";

/**
 * Loads the enabled rules. If this code is live before migration 00024 has
 * been applied, the new columns do not exist yet: fall back to the old ones,
 * where every rule is an assign rule with no product. That keeps the live
 * consignor run working through a deploy-before-migrate slip instead of
 * failing every 5 minutes.
 */
export async function loadEnabledRuleRows(): Promise<RuleRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .select(RULE_SELECT)
    .eq("enabled", true);
  if (!error) return (data ?? []) as RuleRow[];
  if (error.code !== UNDEFINED_COLUMN) throw new Error(`resolveRules: load rules: ${error.message}`);

  const legacy = await admin
    .from("consignor_assignment_rules")
    .select(LEGACY_RULE_SELECT)
    .eq("enabled", true);
  if (legacy.error) throw new Error(`resolveRules: load rules: ${legacy.error.message}`);
  return ((legacy.data ?? []) as Omit<RuleRow, "product_id" | "product_code" | "product_name" | "action">[]).map(
    (r) => ({ ...r, product_id: null, product_code: null, product_name: null, action: "assign" as const })
  );
}

export async function resolveRules(): Promise<ResolvedRules> {
  const rows = await loadEnabledRuleRows();
  if (rows.length === 0) {
    return { validRules: [], invalidRules: [], consigneeNameById: new Map() };
  }

  const needsProducts = rows.some((r) => r.product_id !== null);
  const [entitiesRes, productsRes] = await Promise.all([
    gqlQuery<RspEntities>(Q_ENTITIES_FOR_RULE_VALIDATION, { limit: ENTITY_FETCH_LIMIT }),
    needsProducts ? gqlQuery<RspProducts>(Q_PRODUCTS_ALL) : Promise.resolve(null),
  ]);

  const liveProductIds = productsRes ? new Set(productsRes.products.map((p) => p.id)) : null;
  return validateRules(rows, entitiesRes.entities, liveProductIds);
}
