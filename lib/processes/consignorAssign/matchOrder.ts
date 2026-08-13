/**
 * Pure rule-matching. No I/O — crop resolution and rule loading happen
 * upstream (index.ts / resolveRules.ts); this just decides which rule (if
 * any) applies given a consignee and the set of crop ids present on the
 * order's lines.
 *
 * PRECEDENCE (migration 00018 — global crop rules):
 *   1. (customer, crop)  — most specific, e.g. COLEC + Papaya -> APPEC
 *   2. (any,      crop)  — global crop rule, e.g. any customer + Passionfruit -> SQBR
 *   3. (customer, any)   — customer default, e.g. COLME + any -> MMTRU
 *   4. (any,      any)   — global default; structurally supported, unused today
 *
 * `consigneeFreshtrackId: null` means "any customer" — the same wildcard
 * pattern `cropId: null` ("any crop") already used.
 */

export interface AssignmentRule {
  id: string;
  consigneeFreshtrackId: string | null; // null = any customer (global crop rule)
  cropId: string | null; // null = any crop (default rule)
  consignorFreshtrackId: string;
  consignorEntityCode: string;
}

/**
 * Should crop be resolved for this consignee at all? True if either this
 * exact consignee has a crop-specific rule, OR any GLOBAL crop rule exists —
 * in the latter case we can't know in advance whether the order contains that
 * crop, so it has to be checked. This is a correctness gate, not just an
 * efficiency one: if it wrongly returns false, matchOrder is called with
 * cropIds=null and a global crop rule for a crop actually on the order would
 * be silently missed.
 */
export function needsCropResolution(
  rules: AssignmentRule[],
  consigneeId: string
): boolean {
  return rules.some(
    (r) =>
      r.cropId !== null &&
      (r.consigneeFreshtrackId === consigneeId || r.consigneeFreshtrackId === null)
  );
}

/**
 * `multiple` and `unmapped_crop` were one `ambiguous` outcome until Stage A of
 * the MULTIPLE work. They look alike — both mean "not one consignor" — but
 * they are opposites in the one way that matters:
 *
 *   multiple      every crop resolved, they just disagree. We know ALL the
 *                 consignors, so "MULTIPLE" is a true statement about the
 *                 order and the loads can be split by hand from here.
 *   unmapped_crop at least one crop has no rule at all. We do NOT know its
 *                 consignor, so "MULTIPLE" would be a claim we cannot back —
 *                 it stays a human decision, exactly as before.
 *
 * Unmapped therefore WINS over multiple when both are true: an order with
 * mapped Papaya, mapped Passionfruit and an unmapped third crop is not a
 * known-multiple, it is an unknown.
 */
export type MatchResult =
  | { kind: "matched"; rule: AssignmentRule }
  | { kind: "multiple"; candidateRuleIds: string[]; consignorEntityCodes: string[] }
  | { kind: "unmapped_crop"; matchedRuleIds: string[] }
  | { kind: "no_rule" };

/** The four (consignee, crop) lookups tried in precedence order for one crop. */
function ruleFor(
  rules: AssignmentRule[],
  consigneeId: string,
  cropId: string | null
): AssignmentRule | null {
  const tiers: Array<[string | null, string | null]> = [
    [consigneeId, cropId], // 1. exact
    [null, cropId], // 2. global crop rule
    [consigneeId, null], // 3. customer default
    [null, null], // 4. global default
  ];
  for (const [cId, crId] of tiers) {
    const found = rules.find(
      (r) => r.consigneeFreshtrackId === cId && r.cropId === crId
    );
    if (found) return found;
  }
  return null;
}

/**
 * `cropIds` is the distinct set of crop ids resolved from the order's lines —
 * pass null when `needsCropResolution` was false (crop genuinely can't affect
 * the outcome for this consignee) or the order has no resolvable lines.
 */
export function matchOrder(
  rules: AssignmentRule[],
  consigneeId: string,
  cropIds: string[] | null
): MatchResult {
  if (cropIds === null) {
    const rule = ruleFor(rules, consigneeId, null);
    return rule ? { kind: "matched", rule } : { kind: "no_rule" };
  }
  if (cropIds.length === 0) return { kind: "no_rule" };

  // Match each crop present on the order to its rule via the 4-tier
  // precedence, then see how many DISTINCT consignors that implies.
  const matchedRules: AssignmentRule[] = [];
  let anyCropUnmapped = false;
  for (const cropId of cropIds) {
    const rule = ruleFor(rules, consigneeId, cropId);
    if (rule) {
      matchedRules.push(rule);
    } else {
      anyCropUnmapped = true;
    }
  }

  if (matchedRules.length === 0) return { kind: "no_rule" }; // every crop present is unmapped

  // Checked BEFORE the disagreement test, deliberately — see the MatchResult
  // note. An unmapped crop means we cannot enumerate the consignors, so the
  // order is not a known-multiple however many of the others resolved.
  if (anyCropUnmapped) {
    return { kind: "unmapped_crop", matchedRuleIds: matchedRules.map((r) => r.id) };
  }

  const distinctConsignorIds = new Set(
    matchedRules.map((r) => r.consignorFreshtrackId)
  );
  if (distinctConsignorIds.size > 1) {
    return {
      kind: "multiple",
      candidateRuleIds: matchedRules.map((r) => r.id),
      // Sorted + deduped so the activity log and alerts read consistently
      // regardless of the order crops came back in. Array.from rather than
      // spread — the tsconfig target predates downlevelIteration on Sets.
      consignorEntityCodes: Array.from(
        new Set(matchedRules.map((r) => r.consignorEntityCode))
      ).sort(),
    };
  }
  return { kind: "matched", rule: matchedRules[0] };
}
