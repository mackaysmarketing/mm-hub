import { describe, it, expect } from "vitest";
import { hasCropSpecificRule, matchOrder, type AssignmentRule } from "./matchOrder";

const CROP_PAPAYA = "crop-papaya";
const CROP_PASSION = "crop-passion";
const CROP_MANGO = "crop-mango";

const COLME = "consignee-colme"; // crop-agnostic, single default rule
const COLEC = "consignee-colec"; // crop-specific

const RULES: AssignmentRule[] = [
  {
    id: "rule-colme",
    consigneeFreshtrackId: COLME,
    cropId: null,
    consignorFreshtrackId: "consignor-mmtru",
    consignorEntityCode: "MMTRU",
  },
  {
    id: "rule-colec-papaya",
    consigneeFreshtrackId: COLEC,
    cropId: CROP_PAPAYA,
    consignorFreshtrackId: "consignor-appec",
    consignorEntityCode: "APPEC",
  },
  // Deliberately NO default rule and NO passionfruit rule for COLEC —
  // matches the real seed data (design doc §9.1, §10).
];

describe("hasCropSpecificRule", () => {
  it("is false for a crop-agnostic customer", () => {
    expect(hasCropSpecificRule(RULES, COLME)).toBe(false);
  });

  it("is true for a customer with any crop-specific row", () => {
    expect(hasCropSpecificRule(RULES, COLEC)).toBe(true);
  });

  it("is false for a customer with no rules at all", () => {
    expect(hasCropSpecificRule(RULES, "consignee-unknown")).toBe(false);
  });
});

describe("matchOrder — crop-agnostic customer (the common case)", () => {
  it("matches the single default rule regardless of cropIds", () => {
    expect(matchOrder(RULES, COLME, null)).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
    expect(matchOrder(RULES, COLME, [CROP_MANGO])).toEqual({
      kind: "matched",
      rule: RULES[0],
    });
  });
});

describe("matchOrder — no rule for this consignee at all", () => {
  it("returns no_rule, never guesses", () => {
    expect(matchOrder(RULES, "consignee-unmapped", null)).toEqual({
      kind: "no_rule",
    });
  });
});

describe("matchOrder — crop-specific customer (COLEC)", () => {
  it("matches Papaya to its rule", () => {
    expect(matchOrder(RULES, COLEC, [CROP_PAPAYA])).toEqual({
      kind: "matched",
      rule: RULES[1],
    });
  });

  it("returns no_rule for Passionfruit — deliberately unmapped, never guessed", () => {
    expect(matchOrder(RULES, COLEC, [CROP_PASSION])).toEqual({
      kind: "no_rule",
    });
  });

  it("returns no_rule when crop resolution found nothing (no lines)", () => {
    expect(matchOrder(RULES, COLEC, [])).toEqual({ kind: "no_rule" });
    expect(matchOrder(RULES, COLEC, null)).toEqual({ kind: "no_rule" });
  });

  it("flags ambiguous_multi_crop when an order mixes Papaya and Passionfruit — the real failure mode this exists to catch", () => {
    const result = matchOrder(RULES, COLEC, [CROP_PAPAYA, CROP_PASSION]);
    expect(result.kind).toBe("ambiguous");
  });

  it("does NOT flag ambiguous when both lines resolve to the SAME consignor", () => {
    const rulesWithTwoMangoIshCrops: AssignmentRule[] = [
      ...RULES,
      {
        id: "rule-colec-mango",
        consigneeFreshtrackId: COLEC,
        cropId: CROP_MANGO,
        consignorFreshtrackId: "consignor-appec", // same target as Papaya
        consignorEntityCode: "APPEC",
      },
    ];
    const result = matchOrder(
      rulesWithTwoMangoIshCrops,
      COLEC,
      [CROP_PAPAYA, CROP_MANGO]
    );
    expect(result).toEqual({ kind: "matched", rule: rulesWithTwoMangoIshCrops[1] });
  });

  it("falls back to a default rule for a crop with no specific row, when one exists", () => {
    const withDefault: AssignmentRule[] = [
      ...RULES,
      {
        id: "rule-colec-default",
        consigneeFreshtrackId: COLEC,
        cropId: null,
        consignorFreshtrackId: "consignor-fallback",
        consignorEntityCode: "FALLBACK",
      },
    ];
    // Mango has no specific rule for COLEC in this set — should use the default.
    expect(matchOrder(withDefault, COLEC, [CROP_MANGO])).toEqual({
      kind: "matched",
      rule: withDefault[2],
    });
  });
});
