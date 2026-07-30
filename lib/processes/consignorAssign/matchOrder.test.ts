import { describe, it, expect } from "vitest";
import { needsCropResolution, matchOrder, type AssignmentRule } from "./matchOrder";

const CROP_PAPAYA = "crop-papaya";
const CROP_PASSION = "crop-passion";
const CROP_MANGO = "crop-mango";

const COLME = "consignee-colme"; // crop-agnostic, single default rule
const COLEC = "consignee-colec"; // crop-specific (Papaya only)
const ALDIS = "consignee-aldis"; // crop-agnostic, default -> SQBR already

const CONSIGNOR_MMTRU = "consignor-mmtru";
const CONSIGNOR_APPEC = "consignor-appec";
const CONSIGNOR_SQBRL = "consignor-sqbrl";

// Mirrors the real seeded set after migration 00018: 9 crop-agnostic customer
// defaults + 1 customer-specific crop rule (COLEC/Papaya) + 1 GLOBAL crop
// rule (any customer, Passionfruit -> SQBR). Deliberately no COLEC/Passionfruit
// row — the global rule is what covers it now.
const RULES: AssignmentRule[] = [
  {
    id: "rule-colme-default",
    consigneeFreshtrackId: COLME,
    cropId: null,
    consignorFreshtrackId: CONSIGNOR_MMTRU,
    consignorEntityCode: "MMTRU",
  },
  {
    id: "rule-aldis-default",
    consigneeFreshtrackId: ALDIS,
    cropId: null,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  },
  {
    id: "rule-colec-papaya",
    consigneeFreshtrackId: COLEC,
    cropId: CROP_PAPAYA,
    consignorFreshtrackId: CONSIGNOR_APPEC,
    consignorEntityCode: "APPEC",
  },
  {
    id: "rule-global-passionfruit",
    consigneeFreshtrackId: null,
    cropId: CROP_PASSION,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  },
];

describe("needsCropResolution", () => {
  it("is true for a customer with its own crop-specific rule", () => {
    expect(needsCropResolution(RULES, COLEC)).toBe(true);
  });

  it("is true for EVERY consignee once any global crop rule exists — correctness gate, not just efficiency", () => {
    // COLME has only a crop-agnostic default, but the global Passionfruit
    // rule means COLME's orders could still contain passionfruit and need
    // to be routed to SQBR instead of COLME's usual MM Truganina default.
    expect(needsCropResolution(RULES, COLME)).toBe(true);
    expect(needsCropResolution(RULES, ALDIS)).toBe(true);
  });

  it("is false when neither a customer-specific nor a global crop rule exists", () => {
    const noGlobalRules = RULES.filter((r) => r.id !== "rule-global-passionfruit");
    expect(needsCropResolution(noGlobalRules, COLME)).toBe(false);
  });

  it("is false for an unmapped consignee when no global rule exists", () => {
    const noGlobalRules = RULES.filter((r) => r.id !== "rule-global-passionfruit");
    expect(needsCropResolution(noGlobalRules, "consignee-unknown")).toBe(false);
  });
});

describe("matchOrder — precedence tier 1: customer + crop beats everything", () => {
  it("COLEC + Papaya matches COLEC's own rule, not any global fallback", () => {
    expect(matchOrder(RULES, COLEC, [CROP_PAPAYA])).toEqual({
      kind: "matched",
      rule: RULES[2],
    });
  });
});

describe("matchOrder — precedence tier 2: global crop rule, the actual ask", () => {
  it("ANY customer's Passionfruit routes to SQBR via the global rule", () => {
    // COLME's own default is MM Truganina, but Passionfruit overrides it.
    expect(matchOrder(RULES, COLME, [CROP_PASSION])).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });

  it("resolves the previously-open COLEC Passionfruit question via the SAME global rule", () => {
    expect(matchOrder(RULES, COLEC, [CROP_PASSION])).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });

  it("a customer whose default ALREADY points to SQBR still resolves cleanly (no false ambiguity)", () => {
    expect(matchOrder(RULES, ALDIS, [CROP_PASSION])).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });
});

describe("matchOrder — precedence tier 3: customer default, the pre-00018 common case", () => {
  it("a crop with no customer-specific or global rule falls back to the customer default", () => {
    expect(matchOrder(RULES, COLME, [CROP_MANGO])).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });

  it("crop-agnostic evaluation (cropIds=null) still finds the customer default", () => {
    expect(matchOrder(RULES, COLME, null)).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });
});

describe("matchOrder — no rule anywhere", () => {
  it("an entirely unmapped consignee with an unmapped crop returns no_rule", () => {
    expect(matchOrder(RULES, "consignee-unknown", [CROP_MANGO])).toEqual({
      kind: "no_rule",
    });
  });

  it("no lines resolved (empty/null cropIds) for an unmapped consignee returns no_rule", () => {
    expect(matchOrder(RULES, "consignee-unknown", [])).toEqual({ kind: "no_rule" });
    expect(matchOrder(RULES, "consignee-unknown", null)).toEqual({ kind: "no_rule" });
  });
});

describe("matchOrder — mixed crops still get flagged, whichever tier each side comes from", () => {
  it("COLEC Papaya (tier 1) + Passionfruit (tier 2, global) is ambiguous, not silently Papaya's consignor", () => {
    const result = matchOrder(RULES, COLEC, [CROP_PAPAYA, CROP_PASSION]);
    expect(result.kind).toBe("ambiguous");
  });

  it("COLME Mango (tier 3, its own default) + Passionfruit (tier 2, global) is ALSO ambiguous — a customer's normal fruit mixed with passionfruit still needs a human", () => {
    const result = matchOrder(RULES, COLME, [CROP_MANGO, CROP_PASSION]);
    expect(result.kind).toBe("ambiguous");
  });

  it("does NOT flag ambiguous when both crops resolve to the SAME consignor", () => {
    // ALDIS's own default already IS SQBRL, so Passionfruit (global -> SQBRL)
    // agrees with Mango (ALDIS default -> SQBRL) — same consignor, no conflict.
    // Which specific rule record "wins" isn't a meaningful contract here (both
    // are valid, agreeing matches) — only the resolved consignor is.
    const result = matchOrder(RULES, ALDIS, [CROP_MANGO, CROP_PASSION]);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.rule.consignorFreshtrackId).toBe(CONSIGNOR_SQBRL);
    }
  });
});

describe("matchOrder — a fully wildcard (any customer, any crop) rule, structurally supported", () => {
  const rulesWithGlobalDefault: AssignmentRule[] = [
    ...RULES,
    {
      id: "rule-global-default",
      consigneeFreshtrackId: null,
      cropId: null,
      consignorFreshtrackId: "consignor-fallback",
      consignorEntityCode: "FALLBACK",
    },
  ];

  it("an entirely unmapped consignee now falls through to the global default instead of no_rule", () => {
    expect(matchOrder(rulesWithGlobalDefault, "consignee-unknown", [CROP_MANGO])).toEqual({
      kind: "matched",
      rule: rulesWithGlobalDefault[4],
    });
  });

  it("a known customer's own default still wins over the global default", () => {
    expect(matchOrder(rulesWithGlobalDefault, COLME, [CROP_MANGO])).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });
});
