/**
 * Turns what the rule form sends into the rows to store — one place for every
 * check, shared by POST (create) and PATCH (edit) so the two cannot drift.
 *
 * Products are chosen by FreshTrack product CODE (910101, PBIN …) and
 * resolved here against the live catalogue, so the stored id, code and name
 * always agree with FreshTrack at save time. Picking several products makes
 * one rule each: the rule model stays one product per row, which keeps the
 * unique index and the matching tiers simple, while the form stays quick.
 */
import type { RuleAction } from "./matchOrder";

export interface LiveProduct {
  id: string;
  code: string;
  name: string;
  cropId: string | null;
}

export interface RuleInput {
  consignee_entity_code?: string | null;
  consignee_freshtrack_id?: string | null;
  crop_id?: string | null;
  crop_name?: string | null;
  /** Create: several products, one rule each. */
  product_codes?: string[] | null;
  /** Edit: the one product of an existing rule ("" or null = none). */
  product_code?: string | null;
  action?: string | null;
  consignor_entity_code?: string | null;
  consignor_freshtrack_id?: string | null;
  notes?: string | null;
}

export interface RuleInsertRow {
  consignee_entity_code: string | null;
  consignee_freshtrack_id: string | null;
  crop_id: string | null;
  crop_name: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  action: RuleAction;
  consignor_entity_code: string | null;
  consignor_freshtrack_id: string | null;
  notes: string | null;
}

export type RuleInputResult = { ok: true; rows: RuleInsertRow[] } | { ok: false; error: string };

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

export function buildRuleRows(input: RuleInput, products: LiveProduct[]): RuleInputResult {
  const action = clean(input.action) ?? "assign";
  if (action !== "assign" && action !== "leave_blank") {
    return { ok: false, error: "Action must be 'assign' or 'leave_blank'." };
  }

  const consigneeCode = clean(input.consignee_entity_code);
  const consigneeId = clean(input.consignee_freshtrack_id);
  if (Boolean(consigneeCode) !== Boolean(consigneeId)) {
    return {
      ok: false,
      error:
        "Customer code and FreshTrack role id must be given together, or both left blank for an any-customer rule.",
    };
  }

  const cropId = clean(input.crop_id);
  const cropName = clean(input.crop_name);

  // Codes from either field, trimmed, case-folded and de-duplicated.
  const rawCodes = [...(input.product_codes ?? []), input.product_code ?? ""];
  const codes = Array.from(
    new Set(rawCodes.map((c) => clean(c)?.toUpperCase()).filter((c): c is string => Boolean(c)))
  );

  if (cropId && codes.length > 0) {
    return { ok: false, error: "A rule targets a crop or products, not both." };
  }
  if (!consigneeCode && !cropId && codes.length === 0) {
    return {
      ok: false,
      error: "A rule needs a customer, a crop or a product — leaving all three blank would match every order.",
    };
  }

  const byCode = new Map(products.map((p) => [p.code.trim().toUpperCase(), p]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    return { ok: false, error: `FreshTrack has no product with code ${missing.join(", ")}.` };
  }

  let consignorCode: string | null = null;
  let consignorId: string | null = null;
  if (action === "assign") {
    consignorCode = clean(input.consignor_entity_code);
    consignorId = clean(input.consignor_freshtrack_id);
    if (!consignorCode || !consignorId) {
      return { ok: false, error: "An assign rule needs a consignor code and its FreshTrack role id." };
    }
  }

  const base = {
    consignee_entity_code: consigneeCode,
    consignee_freshtrack_id: consigneeId,
    action: action as RuleAction,
    consignor_entity_code: consignorCode,
    consignor_freshtrack_id: consignorId,
    notes: clean(input.notes),
  };

  if (codes.length === 0) {
    return {
      ok: true,
      rows: [
        {
          ...base,
          crop_id: cropId,
          crop_name: cropId ? cropName : null,
          product_id: null,
          product_code: null,
          product_name: null,
        },
      ],
    };
  }

  return {
    ok: true,
    rows: codes.map((code) => {
      const p = byCode.get(code)!;
      return {
        ...base,
        crop_id: null,
        crop_name: null,
        product_id: p.id,
        product_code: p.code,
        product_name: p.name,
      };
    }),
  };
}
