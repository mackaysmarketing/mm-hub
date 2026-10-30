import { describe, it, expect } from "vitest";
import {
  needsLineResolution,
  matchOrder,
  type AssignmentRule,
  type OrderLine,
} from "./matchOrder";

/** Rule fixture with the defaults every pre-product rule had: assign, no product. */
function rule(over: Partial<AssignmentRule> & Pick<AssignmentRule, "id">): AssignmentRule {
  return {
    consigneeFreshtrackId: null,
    cropId: null,
    productId: null,
    action: "assign",
    consignorFreshtrackId: null,
    consignorEntityCode: null,
    ...over,
  };
}

/**
 * One product per crop, so a list of crops maps 1:1 onto order lines — the
 * shape every test written before product-level rules assumed. Keeping those
 * tests word for word (only the call shape changes) is the proof that adding
 * the product tier changed nothing for the rules that already exist.
 */
const lines = (...cropIds: string[]): OrderLine[] =>
  cropIds.map((cropId) => ({ productId: `prod-of-${cropId}`, cropId }));

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
  rule({
    id: "rule-colme-default",
    consigneeFreshtrackId: COLME,
    consignorFreshtrackId: CONSIGNOR_MMTRU,
    consignorEntityCode: "MMTRU",
  }),
  rule({
    id: "rule-aldis-default",
    consigneeFreshtrackId: ALDIS,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  }),
  rule({
    id: "rule-colec-papaya",
    consigneeFreshtrackId: COLEC,
    cropId: CROP_PAPAYA,
    consignorFreshtrackId: CONSIGNOR_APPEC,
    consignorEntityCode: "APPEC",
  }),
  rule({
    id: "rule-global-passionfruit",
    consigneeFreshtrackId: null,
    cropId: CROP_PASSION,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  }),
];

describe("needsLineResolution", () => {
  it("is true for a customer with its own crop-specific rule", () => {
    expect(needsLineResolution(RULES, COLEC)).toBe(true);
  });

  it("is true for EVERY consignee once any global crop rule exists — correctness gate, not just efficiency", () => {
    // COLME has only a crop-agnostic default, but the global Passionfruit
    // rule means COLME's orders could still contain passionfruit and need
    // to be routed to SQBR instead of COLME's usual MM Truganina default.
    expect(needsLineResolution(RULES, COLME)).toBe(true);
    expect(needsLineResolution(RULES, ALDIS)).toBe(true);
  });

  it("is false when neither a customer-specific nor a global crop rule exists", () => {
    const noGlobalRules = RULES.filter((r) => r.id !== "rule-global-passionfruit");
    expect(needsLineResolution(noGlobalRules, COLME)).toBe(false);
  });

  it("is false for an unmapped consignee when no global rule exists", () => {
    const noGlobalRules = RULES.filter((r) => r.id !== "rule-global-passionfruit");
    expect(needsLineResolution(noGlobalRules, "consignee-unknown")).toBe(false);
  });
});

describe("matchOrder — precedence tier 1: customer + crop beats everything", () => {
  it("COLEC + Papaya matches COLEC's own rule, not any global fallback", () => {
    expect(matchOrder(RULES, COLEC, lines(CROP_PAPAYA))).toEqual({
      kind: "matched",
      rule: RULES[2],
    });
  });
});

describe("matchOrder — precedence tier 2: global crop rule, the actual ask", () => {
  it("ANY customer's Passionfruit routes to SQBR via the global rule", () => {
    // COLME's own default is MM Truganina, but Passionfruit overrides it.
    expect(matchOrder(RULES, COLME, lines(CROP_PASSION))).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });

  it("resolves the previously-open COLEC Passionfruit question via the SAME global rule", () => {
    expect(matchOrder(RULES, COLEC, lines(CROP_PASSION))).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });

  it("a customer whose default ALREADY points to SQBR still resolves cleanly (no false ambiguity)", () => {
    expect(matchOrder(RULES, ALDIS, lines(CROP_PASSION))).toEqual({
      kind: "matched",
      rule: RULES[3],
    });
  });
});

describe("matchOrder — precedence tier 3: customer default, the pre-00018 common case", () => {
  it("a crop with no customer-specific or global rule falls back to the customer default", () => {
    expect(matchOrder(RULES, COLME, lines(CROP_MANGO))).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });

  it("crop-agnostic evaluation (lines=null) still finds the customer default", () => {
    expect(matchOrder(RULES, COLME, null)).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });
});

describe("matchOrder — no rule anywhere", () => {
  it("an entirely unmapped consignee with an unmapped crop returns no_rule", () => {
    expect(matchOrder(RULES, "consignee-unknown", lines(CROP_MANGO))).toEqual({
      kind: "no_rule",
    });
  });

  it("no lines resolved (empty/null lines) for an unmapped consignee returns no_rule", () => {
    expect(matchOrder(RULES, "consignee-unknown", [])).toEqual({ kind: "no_rule" });
    expect(matchOrder(RULES, "consignee-unknown", null)).toEqual({ kind: "no_rule" });
  });
});

describe("matchOrder — mixed crops resolve to MULTIPLE, whichever tier each side comes from", () => {
  it("COLEC Papaya (tier 1) + Passionfruit (tier 2, global) is multiple, not silently Papaya's consignor", () => {
    const result = matchOrder(RULES, COLEC, lines(CROP_PAPAYA, CROP_PASSION));
    expect(result.kind).toBe("multiple");
    if (result.kind === "multiple") {
      // Both consignors named, so "MULTIPLE" on the header is a statement we
      // can actually back — and the codes tell whoever splits the loads which
      // two they are.
      expect(result.consignorEntityCodes).toEqual(["APPEC", "SQBRL"]);
      expect(result.candidateRuleIds).toHaveLength(2);
    }
  });

  it("COLME Mango (tier 3, its own default) + Passionfruit (tier 2, global) is ALSO multiple", () => {
    const result = matchOrder(RULES, COLME, lines(CROP_MANGO, CROP_PASSION));
    expect(result.kind).toBe("multiple");
  });

  it("consignorEntityCodes is sorted and deduped, so the log reads the same however crops arrive", () => {
    const a = matchOrder(RULES, COLEC, lines(CROP_PAPAYA, CROP_PASSION));
    const b = matchOrder(RULES, COLEC, lines(CROP_PASSION, CROP_PAPAYA));
    expect(a.kind).toBe("multiple");
    expect(b.kind).toBe("multiple");
    if (a.kind === "multiple" && b.kind === "multiple") {
      expect(a.consignorEntityCodes).toEqual(b.consignorEntityCodes);
    }
  });

  it("does NOT flag multiple when both crops resolve to the SAME consignor", () => {
    // ALDIS's own default already IS SQBRL, so Passionfruit (global -> SQBRL)
    // agrees with Mango (ALDIS default -> SQBRL) — same consignor, no conflict.
    // Which specific rule record "wins" isn't a meaningful contract here (both
    // are valid, agreeing matches) — only the resolved consignor is.
    const result = matchOrder(RULES, ALDIS, lines(CROP_MANGO, CROP_PASSION));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.rule.consignorFreshtrackId).toBe(CONSIGNOR_SQBRL);
    }
  });
});

describe("matchOrder — unmapped_crop is NOT multiple", () => {
  /**
   * The distinction Stage A turns on. MULTIPLE asserts "we know every
   * consignor on this order and they disagree". A crop with no rule breaks
   * that claim, so it must stay a human decision — otherwise an order would
   * get a MULTIPLE header while nobody can say what the second consignor
   * should even be.
   */
  const CROP_LYCHEE = "crop-lychee"; // no rule anywhere in RULES

  it("a mapped crop plus an unmapped one is unmapped_crop, not multiple", () => {
    const result = matchOrder(RULES, COLEC, lines(CROP_PAPAYA, CROP_LYCHEE));
    expect(result.kind).toBe("unmapped_crop");
    if (result.kind === "unmapped_crop") {
      expect(result.matchedRuleIds).toHaveLength(1); // only Papaya resolved
    }
  });

  it("unmapped wins even when the mapped crops ALSO disagree", () => {
    // Papaya -> APPEC, Passionfruit -> SQBRL, Lychee -> nothing. Two known
    // consignors disagreeing would be `multiple`, but the unknown third makes
    // the set unenumerable, so it is not a MULTIPLE.
    const result = matchOrder(RULES, COLEC, lines(CROP_PAPAYA, CROP_PASSION, CROP_LYCHEE));
    expect(result.kind).toBe("unmapped_crop");
  });

  it("every crop unmapped is still no_rule, not unmapped_crop", () => {
    // Nothing matched at all — a different situation, and one the report
    // already labels separately.
    expect(matchOrder(RULES, "consignee-unknown", lines(CROP_LYCHEE))).toEqual({
      kind: "no_rule",
    });
  });
});

describe("matchOrder — a fully wildcard (any customer, any crop) rule, structurally supported", () => {
  const rulesWithGlobalDefault: AssignmentRule[] = [
    ...RULES,
    rule({
      id: "rule-global-default",
      consignorFreshtrackId: "consignor-fallback",
      consignorEntityCode: "FALLBACK",
    }),
  ];

  it("an entirely unmapped consignee now falls through to the global default instead of no_rule", () => {
    expect(matchOrder(rulesWithGlobalDefault, "consignee-unknown", lines(CROP_MANGO))).toEqual({
      kind: "matched",
      rule: rulesWithGlobalDefault[4],
    });
  });

  it("a known customer's own default still wins over the global default", () => {
    expect(matchOrder(rulesWithGlobalDefault, COLME, lines(CROP_MANGO))).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });
});

// ---------------------------------------------------------------------------
// Product-level rules (migration 00024) — the Woolworths ask: ripe fruit goes
// to the ripening site, green fruit stays blank until the farm load is linked.
// Product ids mirror the live FreshTrack codes they stand for.
// ---------------------------------------------------------------------------

const WOWTO = "consignee-wowto"; // Woolworths Townsville
const WOWBR = "consignee-wowbr"; // Woolworths Brisbane
const CROP_BANANA = "crop-banana";
const P_GREEN_15KG = "prod-910101"; // XL 15kg carton, green
const P_SEMI_15KG = "prod-910102"; // XL 15kg carton, semi ripe
const P_RIPE_15KG = "prod-910103"; // XL 15kg carton, ripe
const P_GREEN_COLLAR = "prod-910109"; // 450g collars, green
const P_RIPE_COLLAR = "prod-910111"; // 450g collars, ripe
const CONSIGNOR_MMANN = "consignor-mmann";

const banana = (productId: string): OrderLine => ({ productId, cropId: CROP_BANANA });

const WOW_RULES: AssignmentRule[] = [
  // Crop level: any Townsville banana -> MM Ann Road ...
  rule({
    id: "wowto-banana",
    consigneeFreshtrackId: WOWTO,
    cropId: CROP_BANANA,
    consignorFreshtrackId: CONSIGNOR_MMANN,
    consignorEntityCode: "MMANN",
  }),
  // ... except green 15kg, which stays blank for the farm load ...
  rule({
    id: "wowto-green15-blank",
    consigneeFreshtrackId: WOWTO,
    productId: P_GREEN_15KG,
    action: "leave_blank",
  }),
  // ... and ripe collars, which ship from SQBR.
  rule({
    id: "wowto-ripecollar-sqbr",
    consigneeFreshtrackId: WOWTO,
    productId: P_RIPE_COLLAR,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  }),
  // Any customer: green collars always stay blank.
  rule({
    id: "global-greencollar-blank",
    consigneeFreshtrackId: null,
    productId: P_GREEN_COLLAR,
    action: "leave_blank",
  }),
  rule({
    id: "wowbr-default",
    consigneeFreshtrackId: WOWBR,
    consignorFreshtrackId: CONSIGNOR_SQBRL,
    consignorEntityCode: "SQBRL",
  }),
];
const byId = (id: string) => WOW_RULES.find((r) => r.id === id)!;

describe("needsLineResolution — product rules", () => {
  it("is true for a customer with a product rule", () => {
    const customerOnly = WOW_RULES.filter((r) => r.id !== "global-greencollar-blank");
    expect(needsLineResolution(customerOnly, WOWTO)).toBe(true);
  });

  it("is true for every customer once an any-customer product rule exists", () => {
    // WOWBR has only a default, but a green-collar line on its order must
    // still be found and left blank.
    expect(needsLineResolution(WOW_RULES, WOWBR)).toBe(true);
  });

  it("is false when only customer defaults exist", () => {
    expect(needsLineResolution([byId("wowbr-default")], WOWBR)).toBe(false);
  });
});

describe("matchOrder — product precedence", () => {
  it("a customer's product rule beats the same customer's crop rule", () => {
    expect(matchOrder(WOW_RULES, WOWTO, [banana(P_RIPE_COLLAR)])).toEqual({
      kind: "matched",
      rule: byId("wowto-ripecollar-sqbr"),
    });
  });

  it("a product with no product rule falls back to the crop rule", () => {
    expect(matchOrder(WOW_RULES, WOWTO, [banana(P_SEMI_15KG)])).toEqual({
      kind: "matched",
      rule: byId("wowto-banana"),
    });
  });

  it("an any-customer product rule beats a customer's crop rule", () => {
    expect(matchOrder(WOW_RULES, WOWTO, [banana(P_GREEN_COLLAR)])).toEqual({
      kind: "left_blank",
      matchedRuleIds: ["global-greencollar-blank"],
    });
  });

  it("a customer's own product rule beats an any-customer product rule", () => {
    const own = rule({
      id: "wowto-greencollar-mmann",
      consigneeFreshtrackId: WOWTO,
      productId: P_GREEN_COLLAR,
      consignorFreshtrackId: CONSIGNOR_MMANN,
      consignorEntityCode: "MMANN",
    });
    expect(matchOrder([...WOW_RULES, own], WOWTO, [banana(P_GREEN_COLLAR)])).toEqual({
      kind: "matched",
      rule: own,
    });
  });

  it("a product rule matches even when the product's crop is unknown", () => {
    expect(matchOrder(WOW_RULES, WOWTO, [{ productId: P_RIPE_COLLAR, cropId: null }])).toEqual({
      kind: "matched",
      rule: byId("wowto-ripecollar-sqbr"),
    });
  });

  it("an unknown-crop product still falls to the customer default", () => {
    expect(matchOrder(WOW_RULES, WOWBR, [{ productId: "prod-unknown", cropId: null }])).toEqual({
      kind: "matched",
      rule: byId("wowbr-default"),
    });
  });
});

describe("matchOrder — leave blank", () => {
  it("an order of only leave-blank products is left blank, not a decision", () => {
    const result = matchOrder(WOW_RULES, WOWTO, [banana(P_GREEN_15KG), banana(P_GREEN_COLLAR)]);
    expect(result.kind).toBe("left_blank");
    if (result.kind === "left_blank") {
      expect([...result.matchedRuleIds].sort()).toEqual([
        "global-greencollar-blank",
        "wowto-green15-blank",
      ]);
    }
  });

  it("leave blank plus an assigned product is mixed_leave_blank — never MULTIPLE, never a guess", () => {
    // The real Townsville shape: green 15kg + semi ripe 15kg + ripe collars.
    const result = matchOrder(WOW_RULES, WOWTO, [
      banana(P_GREEN_15KG),
      banana(P_SEMI_15KG),
      banana(P_RIPE_COLLAR),
    ]);
    expect(result.kind).toBe("mixed_leave_blank");
    if (result.kind === "mixed_leave_blank") {
      expect(result.consignorEntityCodes).toEqual(["MMANN", "SQBRL"]);
      expect(result.matchedRuleIds).toHaveLength(3);
    }
  });

  it("an unmapped product wins over leave blank", () => {
    const result = matchOrder(WOW_RULES, WOWTO, [
      banana(P_GREEN_15KG),
      { productId: "prod-lychee", cropId: "crop-lychee" },
    ]);
    expect(result.kind).toBe("unmapped_crop");
  });

  it("a customer default set to leave blank leaves the order blank without reading its lines", () => {
    const blankDefault = rule({ id: "wowta-blank", consigneeFreshtrackId: "consignee-wowta", action: "leave_blank" });
    expect(matchOrder([blankDefault], "consignee-wowta", null)).toEqual({
      kind: "left_blank",
      matchedRuleIds: ["wowta-blank"],
    });
  });
});

describe("matchOrder — several assigned products", () => {
  it("two products that resolve to the same consignor are one match, not MULTIPLE", () => {
    const ripe15 = rule({
      id: "wowto-ripe15-mmann",
      consigneeFreshtrackId: WOWTO,
      productId: P_RIPE_15KG,
      consignorFreshtrackId: CONSIGNOR_MMANN,
      consignorEntityCode: "MMANN",
    });
    const result = matchOrder([...WOW_RULES, ripe15], WOWTO, [banana(P_SEMI_15KG), banana(P_RIPE_15KG)]);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.rule.consignorFreshtrackId).toBe(CONSIGNOR_MMANN);
    }
  });

  it("two assigned products with different consignors are MULTIPLE", () => {
    const result = matchOrder(WOW_RULES, WOWTO, [banana(P_SEMI_15KG), banana(P_RIPE_COLLAR)]);
    expect(result.kind).toBe("multiple");
    if (result.kind === "multiple") {
      expect(result.consignorEntityCodes).toEqual(["MMANN", "SQBRL"]);
    }
  });

  it("the same product on two lines counts once", () => {
    expect(matchOrder(WOW_RULES, WOWTO, [banana(P_SEMI_15KG), banana(P_SEMI_15KG)])).toEqual({
      kind: "matched",
      rule: byId("wowto-banana"),
    });
  });
});
