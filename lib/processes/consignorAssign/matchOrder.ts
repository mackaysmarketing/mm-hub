/**
 * Pure rule-matching. No I/O — crop resolution and rule loading happen
 * upstream (index.ts / resolveRules.ts); this just decides which rule (if
 * any) applies given a consignee and the set of crop ids present on the
 * order's lines.
 */

export interface AssignmentRule {
  id: string;
  consigneeFreshtrackId: string;
  cropId: string | null; // null = "any crop" default rule
  consignorFreshtrackId: string;
  consignorEntityCode: string;
}

/**
 * Does this consignee have at least one crop-specific rule? Used upstream to
 * decide whether the expensive orderVersions -> orderItems -> product crop
 * lookup is worth paying for at all — crop-agnostic customers (9 of 10) never
 * need it.
 */
export function hasCropSpecificRule(
  rules: AssignmentRule[],
  consigneeId: string
): boolean {
  return rules.some(
    (r) => r.consigneeFreshtrackId === consigneeId && r.cropId !== null
  );
}

export type MatchResult =
  | { kind: "matched"; rule: AssignmentRule }
  | { kind: "ambiguous"; candidateRuleIds: string[] }
  | { kind: "no_rule" };

/**
 * `cropIds` is the distinct set of crop ids resolved from the order's lines —
 * pass null/[] for a crop-agnostic consignee (no fetch needed) or when an
 * order genuinely has no resolvable lines.
 */
export function matchOrder(
  rules: AssignmentRule[],
  consigneeId: string,
  cropIds: string[] | null
): MatchResult {
  const forConsignee = rules.filter(
    (r) => r.consigneeFreshtrackId === consigneeId
  );
  if (forConsignee.length === 0) return { kind: "no_rule" };

  const defaultRule = forConsignee.find((r) => r.cropId === null) ?? null;
  const cropRules = forConsignee.filter((r) => r.cropId !== null);

  if (cropRules.length === 0) {
    // Crop-agnostic customer — the common case (9 of 10).
    return defaultRule ? { kind: "matched", rule: defaultRule } : { kind: "no_rule" };
  }

  // Crop-specific customer (COLEC today): match each crop present on the
  // order to its rule (falling back to the consignee's default rule, if any,
  // for a crop with no specific row).
  const crops = cropIds ?? [];
  if (crops.length === 0) return { kind: "no_rule" };

  const matchedRules: AssignmentRule[] = [];
  let anyCropUnmapped = false;
  for (const cropId of crops) {
    const rule = cropRules.find((cr) => cr.cropId === cropId) ?? defaultRule;
    if (rule) {
      matchedRules.push(rule);
    } else {
      anyCropUnmapped = true;
    }
  }

  if (matchedRules.length === 0) return { kind: "no_rule" }; // every crop present is unmapped

  // A crop present with NO matching rule is just as unsafe to guess through
  // as two rules disagreeing — e.g. a COLEC order with mapped Papaya AND
  // unmapped Passionfruit lines must not be silently assigned to the Papaya
  // consignor. Both cases land in the same review queue.
  const distinctConsignorIds = new Set(
    matchedRules.map((r) => r.consignorFreshtrackId)
  );
  if (anyCropUnmapped || distinctConsignorIds.size > 1) {
    return {
      kind: "ambiguous",
      candidateRuleIds: matchedRules.map((r) => r.id),
    };
  }
  return { kind: "matched", rule: matchedRules[0] };
}
