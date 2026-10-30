/**
 * Pure rule-matching. No I/O — line resolution and rule loading happen
 * upstream (index.ts / resolveRules.ts); this just decides which rule (if
 * any) applies given a consignee and the products on the order's lines.
 *
 * PRECEDENCE, per product on the order (migrations 00018 and 00024):
 *   1. (customer, product) — e.g. WOWTO + 910111 ripe collars -> SQBRL
 *   2. (any,      product) — e.g. any customer + 910109 green collars -> leave blank
 *   3. (customer, crop)    — e.g. COLEC + Papaya -> APPEC
 *   4. (any,      crop)    — global crop rule, e.g. any + Passionfruit -> SQBR
 *   5. (customer, any)     — customer default, e.g. COLME + any -> MMTRU
 *   6. (any,      any)     — global default; structurally supported, unused today
 *
 * What the fruit is outranks who the customer is — the same call 00018 made
 * for crops ("all Passionfruit via SQBR, whoever orders it") — and within each
 * level the customer's own rule beats an any-customer one. With no product
 * rules, tiers 1–2 never match and the result is exactly the pre-00024 one.
 *
 * `null` means "any" on every axis. A rule targets a crop OR a product, never
 * both (consignor_rules_crop_or_product).
 */

export type RuleAction = "assign" | "leave_blank";

export interface AssignmentRule {
  id: string;
  consigneeFreshtrackId: string | null; // null = any customer
  cropId: string | null; // null = not crop-specific
  productId: string | null; // null = not product-specific
  /**
   * `leave_blank` = this tool must not set a consignor for this product —
   * e.g. green fruit, whose consignor is the farm and is set by hand when the
   * farm load is linked to the customer order.
   */
  action: RuleAction;
  consignorFreshtrackId: string | null; // null only when action = leave_blank
  consignorEntityCode: string | null;
}

/** One distinct product on the order. cropId is null when the catalogue has none. */
export interface OrderLine {
  productId: string;
  cropId: string | null;
}

/**
 * Must the order's lines be read for this consignee at all? True if any rule
 * that could apply to it (its own, or an any-customer one) is crop- or
 * product-specific. This is a correctness gate, not just an efficiency one:
 * if it wrongly returns false, matchOrder is called with lines=null and a
 * crop or product rule for something actually on the order is silently
 * missed.
 */
export function needsLineResolution(
  rules: AssignmentRule[],
  consigneeId: string
): boolean {
  return rules.some(
    (r) =>
      (r.cropId !== null || r.productId !== null) &&
      (r.consigneeFreshtrackId === consigneeId || r.consigneeFreshtrackId === null)
  );
}

/**
 * `multiple` and `unmapped_crop` look alike — both mean "not one consignor" —
 * but they are opposites in the one way that matters:
 *
 *   multiple          every product resolved, they just disagree. We know ALL
 *                     the consignors, so "MULTIPLE" is a true statement.
 *   unmapped_crop     at least one product has no rule at all (the slug
 *                     predates product rules). We do NOT know its consignor,
 *                     so it stays a human decision.
 *   left_blank        every product's rule says "leave blank" — the expected
 *                     outcome for green fruit, not a decision.
 *   mixed_leave_blank some products are left blank and some assigned. The
 *                     header cannot be set truthfully by rule, so a person
 *                     decides.
 *
 * Unmapped WINS over everything else: an order with an unknown product is an
 * unknown, however the rest resolved.
 */
export type MatchResult =
  | { kind: "matched"; rule: AssignmentRule }
  | { kind: "multiple"; candidateRuleIds: string[]; consignorEntityCodes: string[] }
  | { kind: "left_blank"; matchedRuleIds: string[] }
  | { kind: "mixed_leave_blank"; matchedRuleIds: string[]; consignorEntityCodes: string[] }
  | { kind: "unmapped_crop"; matchedRuleIds: string[] }
  | { kind: "no_rule" };

const isAnyProduct = (r: AssignmentRule) => r.cropId === null && r.productId === null;

/** The six lookups, in precedence order. `line` null = crop-agnostic evaluation. */
function ruleFor(
  rules: AssignmentRule[],
  consigneeId: string,
  line: OrderLine | null
): AssignmentRule | null {
  const tiers: Array<(r: AssignmentRule) => boolean> = [];
  if (line) {
    tiers.push((r) => r.consigneeFreshtrackId === consigneeId && r.productId === line.productId);
    tiers.push((r) => r.consigneeFreshtrackId === null && r.productId === line.productId);
    if (line.cropId !== null) {
      const cropId = line.cropId;
      tiers.push(
        (r) => r.consigneeFreshtrackId === consigneeId && r.productId === null && r.cropId === cropId
      );
      tiers.push((r) => r.consigneeFreshtrackId === null && r.productId === null && r.cropId === cropId);
    }
  }
  tiers.push((r) => r.consigneeFreshtrackId === consigneeId && isAnyProduct(r));
  tiers.push((r) => r.consigneeFreshtrackId === null && isAnyProduct(r));

  for (const tier of tiers) {
    const found = rules.find(tier);
    if (found) return found;
  }
  return null;
}

// Array.from rather than spread — the tsconfig target predates
// downlevelIteration on Sets.
const uniq = (values: string[]) => Array.from(new Set(values));
const sortedCodes = (rules: AssignmentRule[]) =>
  uniq(rules.map((r) => r.consignorEntityCode ?? "")).sort();

/**
 * `lines` is the distinct products on the order's latest version — pass null
 * when `needsLineResolution` was false (no crop or product rule can apply to
 * this consignee), in which case only the default tiers are consulted.
 */
export function matchOrder(
  rules: AssignmentRule[],
  consigneeId: string,
  lines: OrderLine[] | null
): MatchResult {
  if (lines === null) {
    const rule = ruleFor(rules, consigneeId, null);
    if (!rule) return { kind: "no_rule" };
    return rule.action === "leave_blank"
      ? { kind: "left_blank", matchedRuleIds: [rule.id] }
      : { kind: "matched", rule };
  }
  if (lines.length === 0) return { kind: "no_rule" };

  const seen = new Set<string>();
  const matchedRules: AssignmentRule[] = [];
  let anyUnmapped = false;
  for (const line of lines) {
    if (seen.has(line.productId)) continue;
    seen.add(line.productId);
    if (line.cropId === null) {
      // A product with no crop (or missing from the catalogue) was ignored
      // before 00024. Only a rule naming that product may decide it now;
      // otherwise it is still ignored, so existing outcomes cannot change.
      const productRule =
        rules.find((r) => r.consigneeFreshtrackId === consigneeId && r.productId === line.productId) ??
        rules.find((r) => r.consigneeFreshtrackId === null && r.productId === line.productId);
      if (productRule) matchedRules.push(productRule);
      continue;
    }
    const rule = ruleFor(rules, consigneeId, line);
    if (rule) matchedRules.push(rule);
    else anyUnmapped = true;
  }

  if (matchedRules.length === 0) return { kind: "no_rule" }; // nothing on the order resolved
  const matchedRuleIds = uniq(matchedRules.map((r) => r.id));

  // Checked first, deliberately — see the MatchResult note.
  if (anyUnmapped) return { kind: "unmapped_crop", matchedRuleIds };

  const assigning = matchedRules.filter((r) => r.action === "assign");
  if (assigning.length === 0) return { kind: "left_blank", matchedRuleIds };
  if (assigning.length < matchedRules.length) {
    return { kind: "mixed_leave_blank", matchedRuleIds, consignorEntityCodes: sortedCodes(assigning) };
  }

  const distinctConsignorIds = new Set(assigning.map((r) => r.consignorFreshtrackId));
  if (distinctConsignorIds.size > 1) {
    return {
      kind: "multiple",
      candidateRuleIds: uniq(assigning.map((r) => r.id)),
      // Sorted + deduped so the activity log and alerts read consistently
      // regardless of the order lines came back in.
      consignorEntityCodes: sortedCodes(assigning),
    };
  }
  return { kind: "matched", rule: assigning[0] };
}
