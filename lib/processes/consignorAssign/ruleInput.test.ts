import { describe, it, expect } from "vitest";
import { buildRuleRows, type LiveProduct } from "./ruleInput";

const PRODUCTS: LiveProduct[] = [
  { id: "p-910101", code: "910101", name: "BananaCavendishPremium XL15kg CartonGreen", cropId: "crop-banana" },
  { id: "p-910102", code: "910102", name: "BananaCavendishPremiumXL15kg Carton Semi Ripe", cropId: "crop-banana" },
  { id: "p-910111", code: "910111", name: "BananaCavendishPremiumL450gCollarsRipe - WOW", cropId: "crop-banana" },
  { id: "p-pbin", code: "PBIN", name: "Processing Bin", cropId: "crop-banana" },
];

const TOWNSVILLE = { consignee_entity_code: "WOWTO", consignee_freshtrack_id: "c-wowto" };
const MMANN = { consignor_entity_code: "MMANN", consignor_freshtrack_id: "r-mmann" };

describe("buildRuleRows", () => {
  it("makes one rule per chosen product, each carrying the product's id, code and name", () => {
    const out = buildRuleRows(
      { ...TOWNSVILLE, ...MMANN, action: "assign", product_codes: ["910102", "910111"] },
      PRODUCTS
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({
      consignee_entity_code: "WOWTO",
      consignee_freshtrack_id: "c-wowto",
      crop_id: null,
      crop_name: null,
      product_id: "p-910102",
      product_code: "910102",
      product_name: "BananaCavendishPremiumXL15kg Carton Semi Ripe",
      action: "assign",
      consignor_entity_code: "MMANN",
      consignor_freshtrack_id: "r-mmann",
    });
    expect(out.rows[1].product_id).toBe("p-910111");
  });

  it("a leave-blank rule stores no consignor, even if one was sent", () => {
    const out = buildRuleRows(
      { ...TOWNSVILLE, ...MMANN, action: "leave_blank", product_codes: ["910101"] },
      PRODUCTS
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]).toMatchObject({
      action: "leave_blank",
      consignor_entity_code: null,
      consignor_freshtrack_id: null,
    });
  });

  it("an assign rule needs a consignor", () => {
    const out = buildRuleRows({ ...TOWNSVILLE, action: "assign", product_codes: ["910101"] }, PRODUCTS);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/consignor/i) });
  });

  it("a rule targets a crop or products, never both", () => {
    const out = buildRuleRows(
      { ...TOWNSVILLE, ...MMANN, crop_id: "crop-banana", crop_name: "Banana", product_codes: ["910101"] },
      PRODUCTS
    );
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/crop or products/i) });
  });

  it("names a product code that FreshTrack does not have", () => {
    const out = buildRuleRows({ ...TOWNSVILLE, ...MMANN, product_codes: ["910101", "999999"] }, PRODUCTS);
    expect(out).toEqual({ ok: false, error: expect.stringContaining("999999") });
  });

  it("refuses a rule that would match every order", () => {
    const out = buildRuleRows({ ...MMANN }, PRODUCTS);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/customer, a crop or a product/i) });
  });

  it("a product rule may be for any customer", () => {
    const out = buildRuleRows({ action: "leave_blank", product_codes: ["910101"] }, PRODUCTS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]).toMatchObject({ consignee_entity_code: null, consignee_freshtrack_id: null });
  });

  it("customer code and role id go together", () => {
    const out = buildRuleRows({ consignee_entity_code: "WOWTO", ...MMANN }, PRODUCTS);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/together/i) });
  });

  it("trims, ignores case and drops repeats in product codes", () => {
    const out = buildRuleRows({ ...TOWNSVILLE, ...MMANN, product_codes: [" pbin ", "PBIN", ""] }, PRODUCTS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows.map((r) => r.product_code)).toEqual(["PBIN"]);
  });

  it("still makes a plain crop rule and a customer default, as before", () => {
    const crop = buildRuleRows(
      { ...TOWNSVILLE, ...MMANN, crop_id: "crop-papaya", crop_name: "Papaya" },
      PRODUCTS
    );
    const dflt = buildRuleRows({ ...TOWNSVILLE, ...MMANN }, PRODUCTS);
    expect(crop.ok && crop.rows).toEqual([
      expect.objectContaining({ crop_id: "crop-papaya", crop_name: "Papaya", product_id: null, action: "assign" }),
    ]);
    expect(dflt.ok && dflt.rows).toEqual([
      expect.objectContaining({ crop_id: null, product_id: null, action: "assign" }),
    ]);
  });

  it("refuses an action it does not know", () => {
    const out = buildRuleRows({ ...TOWNSVILLE, ...MMANN, action: "delete" }, PRODUCTS);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/action/i) });
  });

  it("a single product_code works the same as a one-item list (the edit form sends this)", () => {
    const out = buildRuleRows({ ...TOWNSVILLE, ...MMANN, product_code: "910111" }, PRODUCTS);
    expect(out.ok && out.rows.map((r) => r.product_id)).toEqual(["p-910111"]);
  });
});
