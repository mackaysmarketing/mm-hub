import { describe, it, expect } from "vitest";
import { classifyEntity, classifyBatch, buildChildrenMap } from "./classify";
import type { FTEntity } from "./queries";

function entity(over: Partial<FTEntity> = {}): FTEntity {
  return {
    id: "e",
    code: "X",
    type: "ORG",
    orgName: "X",
    orgLegalName: "",
    orgContactName: "",
    orgTaxNo: "",
    indFirstName: "",
    indMiddleName: "",
    indLastName: "",
    email: "",
    phoneNo: "",
    mobileNo: "",
    isActive: true,
    isGrower: true,
    isConsignorActive: false,
    isConsigneeActive: false,
    isMarketerActive: false,
    isFarmActive: false,
    parentId: null,
    parent: null,
    farmId: null,
    farm: null,
    ...over,
  };
}

describe("classifyEntity — five categories", () => {
  it("non-grower → skip (the 135 non-grower entities in the sample)", () => {
    expect(classifyEntity(entity({ isGrower: false }), { hasChildren: false })).toBe("skip");
  });

  it("grower with children → rcti_recipient (e.g. LMBFA parents LMBCO/LMBEP/LMBBF)", () => {
    expect(
      classifyEntity(entity({ parentId: "MG" }), { hasChildren: true })
    ).toBe("rcti_recipient");
  });

  it("grower with parent + no children → farm (e.g. LMBCO under LMBFA)", () => {
    expect(
      classifyEntity(entity({ parentId: "LMBFA", farmId: "f1" }), { hasChildren: false })
    ).toBe("farm");
  });

  it("self-paid grower (no parent, no children, is its own consignor) → self_paid_farm", () => {
    expect(
      classifyEntity(
        entity({ parentId: null, farmId: "f", isConsignorActive: true }),
        { hasChildren: false }
      )
    ).toBe("self_paid_farm");
  });

  it("grower with neither parent nor children nor consignor → orphan_farm", () => {
    expect(
      classifyEntity(entity({ parentId: null, isConsignorActive: false }), {
        hasChildren: false,
      })
    ).toBe("orphan_farm");
  });
});

describe("buildChildrenMap + classifyBatch — the LMB hierarchy", () => {
  it("classifies a realistic LMB tree in one pass", () => {
    const batch = [
      entity({ id: "MG", code: "MG", parentId: null, orgName: "Mackays Growers" }),
      entity({ id: "LMBFA", code: "LMBFA", parentId: "MG", orgName: "LMB" }),
      entity({ id: "LMBCO", code: "LMBCO", parentId: "LMBFA", farmId: "f-co", orgName: "LMB - Cooroo Bananas" }),
      entity({ id: "LMBEP", code: "LMBEP", parentId: "LMBFA", farmId: "f-ep", orgName: "LMB - East Palmerston" }),
      entity({ id: "LMBBF", code: "LMBBF", parentId: "LMBFA", farmId: "f-bf", orgName: "LMB - Bartle Frere" }),
    ];
    const result = classifyBatch(batch);
    const byCode = Object.fromEntries(result.map((r) => [r.entity.code, r.classification]));
    expect(byCode.MG).toBe("rcti_recipient"); // parents LMBFA
    expect(byCode.LMBFA).toBe("rcti_recipient"); // parents 3 farms
    expect(byCode.LMBCO).toBe("farm");
    expect(byCode.LMBEP).toBe("farm");
    expect(byCode.LMBBF).toBe("farm");
  });

  it("buildChildrenMap is O(1) per lookup", () => {
    const parents = buildChildrenMap([
      entity({ id: "a", parentId: null }),
      entity({ id: "b", parentId: "a" }),
      entity({ id: "c", parentId: "a" }),
    ]);
    expect(parents.has("a")).toBe(true);
    expect(parents.has("b")).toBe(false);
  });
});
