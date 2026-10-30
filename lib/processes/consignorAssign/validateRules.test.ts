import { describe, it, expect } from "vitest";
import { validateRules, type RuleRow, type LiveEntityLite } from "./validateRules";

function row(over: Partial<RuleRow> & Pick<RuleRow, "id">): RuleRow {
  return {
    consignee_entity_code: "WOWTO",
    consignee_freshtrack_id: "c-wowto",
    crop_id: null,
    crop_name: null,
    product_id: null,
    product_code: null,
    product_name: null,
    action: "assign",
    consignor_entity_code: "MMANN",
    consignor_freshtrack_id: "r-mmann",
    ...over,
  };
}

const ENTITIES: LiveEntityLite[] = [
  { consigneeId: "c-wowto", orgName: "Woolworths Townsville", consignorId: null, isConsignorActive: false },
  { consigneeId: null, orgName: "MM Ann Road", consignorId: "r-mmann", isConsignorActive: true },
  { consigneeId: null, orgName: "Old site", consignorId: "r-off", isConsignorActive: false },
];
const PRODUCTS = new Set(["p-910101", "p-910111"]);

describe("validateRules", () => {
  it("passes a product rule that assigns a consignor, carrying product and action through", () => {
    const out = validateRules([row({ id: "r1", product_id: "p-910111", product_code: "910111" })], ENTITIES, PRODUCTS);
    expect(out.invalidRules).toEqual([]);
    expect(out.validRules).toEqual([
      {
        id: "r1",
        consigneeFreshtrackId: "c-wowto",
        cropId: null,
        productId: "p-910111",
        action: "assign",
        consignorFreshtrackId: "r-mmann",
        consignorEntityCode: "MMANN",
      },
    ]);
  });

  it("passes a leave-blank rule with no consignor, without looking one up", () => {
    const out = validateRules(
      [
        row({
          id: "r2",
          product_id: "p-910101",
          action: "leave_blank",
          consignor_entity_code: null,
          consignor_freshtrack_id: null,
        }),
      ],
      ENTITIES,
      PRODUCTS
    );
    expect(out.invalidRules).toEqual([]);
    expect(out.validRules[0]).toMatchObject({ action: "leave_blank", consignorFreshtrackId: null });
  });

  it("rejects an assign rule that has no consignor", () => {
    const out = validateRules(
      [row({ id: "r3", consignor_entity_code: null, consignor_freshtrack_id: null })],
      ENTITIES,
      PRODUCTS
    );
    expect(out.validRules).toEqual([]);
    expect(out.invalidRules[0].reason).toMatch(/no consignor/i);
  });

  it("rejects a product rule whose product is not in the live catalogue", () => {
    const out = validateRules(
      [row({ id: "r4", product_id: "p-gone", product_code: "910999" })],
      ENTITIES,
      PRODUCTS
    );
    expect(out.validRules).toEqual([]);
    expect(out.invalidRules[0].reason).toBe("product 910999 not found live");
  });

  it("rejects product rules when the catalogue could not be loaded, rather than trusting them", () => {
    const out = validateRules([row({ id: "r5", product_id: "p-910111", product_code: "910111" })], ENTITIES, null);
    expect(out.validRules).toEqual([]);
    expect(out.invalidRules[0].reason).toMatch(/catalogue/i);
  });

  it("still rejects an unknown customer and an inactive consignor, as before", () => {
    const out = validateRules(
      [
        row({ id: "r6", consignee_entity_code: "ZZZ", consignee_freshtrack_id: "c-missing" }),
        row({ id: "r7", consignor_entity_code: "OLD", consignor_freshtrack_id: "r-off" }),
      ],
      ENTITIES,
      PRODUCTS
    );
    expect(out.validRules).toEqual([]);
    expect(out.invalidRules.map((r) => r.reason)).toEqual([
      "consignee ZZZ not found live",
      "consignor OLD is not consignor-active",
    ]);
  });

  it("builds the consignee name map from the same entities", () => {
    const out = validateRules([], ENTITIES, PRODUCTS);
    expect(out.consigneeNameById.get("c-wowto")).toBe("Woolworths Townsville");
  });
});
