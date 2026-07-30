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
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FOR_RULE_VALIDATION,
  type RspEntities,
} from "@/lib/freshtrack/queries";
import type { AssignmentRule } from "./matchOrder";

const ENTITY_FETCH_LIMIT = 1000;

export interface RuleRow {
  id: string;
  // null = any customer (global crop rule) — migration 00018.
  consignee_entity_code: string | null;
  consignee_freshtrack_id: string | null;
  crop_id: string | null;
  crop_name: string | null;
  consignor_entity_code: string;
  consignor_freshtrack_id: string;
}

export interface InvalidRule {
  rule: RuleRow;
  reason: string;
}

export interface ResolvedRules {
  validRules: AssignmentRule[];
  invalidRules: InvalidRule[];
}

export async function resolveRules(): Promise<ResolvedRules> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .select(
      "id, consignee_entity_code, consignee_freshtrack_id, crop_id, crop_name, consignor_entity_code, consignor_freshtrack_id"
    )
    .eq("enabled", true);
  if (error) throw new Error(`resolveRules: load rules: ${error.message}`);

  const rows = (data ?? []) as RuleRow[];
  if (rows.length === 0) return { validRules: [], invalidRules: [] };

  const entitiesRes = await gqlQuery<RspEntities>(
    Q_ENTITIES_FOR_RULE_VALIDATION,
    { limit: ENTITY_FETCH_LIMIT }
  );

  const consignorActiveById = new Map<string, boolean>();
  const consigneeExists = new Set<string>();
  for (const e of entitiesRes.entities) {
    if (e.consignorId) consignorActiveById.set(e.consignorId, e.isConsignorActive);
    if (e.consigneeId) consigneeExists.add(e.consigneeId);
  }

  const validRules: AssignmentRule[] = [];
  const invalidRules: InvalidRule[] = [];

  for (const row of rows) {
    // A global rule (consignee_freshtrack_id null) has no consignee to
    // validate — skip straight to the consignor check.
    if (
      row.consignee_freshtrack_id &&
      !consigneeExists.has(row.consignee_freshtrack_id)
    ) {
      invalidRules.push({
        rule: row,
        reason: `consignee ${row.consignee_entity_code} not found live`,
      });
      continue;
    }
    const consignorActive = consignorActiveById.get(row.consignor_freshtrack_id);
    if (consignorActive === undefined) {
      invalidRules.push({
        rule: row,
        reason: `consignor ${row.consignor_entity_code} not found live`,
      });
      continue;
    }
    if (!consignorActive) {
      invalidRules.push({
        rule: row,
        reason: `consignor ${row.consignor_entity_code} is not consignor-active`,
      });
      continue;
    }
    validRules.push({
      id: row.id,
      consigneeFreshtrackId: row.consignee_freshtrack_id,
      cropId: row.crop_id,
      consignorFreshtrackId: row.consignor_freshtrack_id,
      consignorEntityCode: row.consignor_entity_code,
    });
  }

  return { validRules, invalidRules };
}
