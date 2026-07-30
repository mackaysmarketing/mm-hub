import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));

import {
  pickLatestVersion,
  rollupForOrder,
  toFtOrderItemRow,
} from "./orderItemSync";
import type { FTOrderItem, FTProductMini } from "@/lib/freshtrack/queries";

const CROP_PAPAYA = "01931d7a-7265-3570-1ce3-998f9b370afb";
const CROP_PASSION = "01931d81-d565-66bf-6784-3930017e80a2";

const PRODUCTS = new Map<string, FTProductMini>([
  [
    "p-papaya-1",
    { id: "p-papaya-1", code: "920149", name: "PapayaRedPremium 6Papaya Tray", cropId: CROP_PAPAYA },
  ],
  [
    "p-papaya-2",
    { id: "p-papaya-2", code: "920117", name: "PapayaRedPremium XXL10kg", cropId: CROP_PAPAYA },
  ],
  [
    "p-passion-1",
    { id: "p-passion-1", code: "960112", name: "PassionfruitLakeland Red", cropId: CROP_PASSION },
  ],
  [
    "p-nocrop",
    { id: "p-nocrop", code: "999999", name: "Mystery", cropId: null },
  ],
]);

const CROP_NAMES = new Map<string, string>([
  [CROP_PAPAYA, "Papaya"],
  [CROP_PASSION, "Passionfruit"],
]);

function item(over: Partial<FTOrderItem> = {}): FTOrderItem {
  return {
    id: "i-1",
    orderVersionId: "v-1",
    productId: "p-papaya-1",
    shedId: null,
    dispatchLoadId: null,
    palletCount: 2,
    boxesPerPallet: 104,
    handStack: null,
    isSplit: false,
    ti: null,
    unsplitHi: null,
    bottomHi: null,
    topHi: null,
    priceValue: 24.5,
    priceCurrency: "AUD",
    pricePer: "BOX",
    remittedPriceValue: null,
    remittedPriceCurrency: "AUD",
    proposedQuantity: null,
    proposedPriceValue: null,
    proposedPriceCurrency: "AUD",
    discountValue: null,
    discountCurrency: "AUD",
    discountPercentage: null,
    itemNo: "3207978",
    ean13: null,
    ean14: null,
    lineNo: 1,
    ...over,
  };
}

describe("pickLatestVersion", () => {
  it("returns null for no versions", () => {
    expect(pickLatestVersion([])).toBeNull();
  });

  it("picks the highest versionNo, not the last element", () => {
    const v = pickLatestVersion([
      { id: "v-3", versionNo: 3 },
      { id: "v-1", versionNo: 1 },
      { id: "v-2", versionNo: 2 },
    ]);
    expect(v?.id).toBe("v-3");
  });

  it("handles a single version", () => {
    expect(pickLatestVersion([{ id: "v-1", versionNo: 1 }])?.id).toBe("v-1");
  });
});

describe("rollupForOrder", () => {
  it("returns all-null for an order with no lines", () => {
    const r = rollupForOrder([], PRODUCTS, CROP_NAMES);
    expect(r).toEqual({
      product_name: null,
      product_code: null,
      unit_price: null,
      crop_ft_ids: null,
      crop_names: null,
    });
  });

  it("names the product and carries unit_price for a single line", () => {
    const r = rollupForOrder([item()], PRODUCTS, CROP_NAMES);
    expect(r.product_name).toBe("PapayaRedPremium 6Papaya Tray");
    expect(r.product_code).toBe("920149");
    expect(r.unit_price).toBe(24.5);
  });

  it("does NOT emit quantity_ordered — that column is in BOXES and comes from OrderNode.totalOrdered in step 6, not summed pallets", () => {
    const r = rollupForOrder(
      [item({ id: "a", palletCount: 2 }), item({ id: "b", palletCount: 3 })],
      PRODUCTS,
      CROP_NAMES
    ) as unknown as Record<string, unknown>;
    expect(r.quantity_ordered).toBeUndefined();
  });

  it("summarises multiple distinct products and REFUSES a unit_price", () => {
    const r = rollupForOrder(
      [item({ id: "a", productId: "p-papaya-1" }), item({ id: "b", productId: "p-passion-1" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.product_name).toBe("2 products");
    expect(r.product_code).toBeNull();
    // pricePer varies per line, so any aggregate price would be mixed-unit.
    expect(r.unit_price).toBeNull();
  });

  it("treats repeats of one product as a single product", () => {
    const r = rollupForOrder(
      [item({ id: "a" }), item({ id: "b" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.product_name).toBe("PapayaRedPremium 6Papaya Tray");
    // still >1 line, so no unit_price
    expect(r.unit_price).toBeNull();
  });

  it("collapses two products of the same crop into ONE crop — the single-consignor case", () => {
    const r = rollupForOrder(
      [item({ id: "a", productId: "p-papaya-1" }), item({ id: "b", productId: "p-papaya-2" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.crop_ft_ids).toEqual([CROP_PAPAYA]);
    expect(r.crop_names).toEqual(["Papaya"]);
  });

  it("reports BOTH crops when a Coles Eastern Creek order mixes Papaya and Passionfruit — the ambiguous_multi_crop trigger", () => {
    const r = rollupForOrder(
      [item({ id: "a", productId: "p-papaya-1" }), item({ id: "b", productId: "p-passion-1" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.crop_ft_ids).toHaveLength(2);
    expect(r.crop_names?.sort()).toEqual(["Papaya", "Passionfruit"]);
  });

  it("sorts crop ids so the cached set is comparison-stable regardless of line order", () => {
    const a = rollupForOrder(
      [item({ id: "a", productId: "p-papaya-1" }), item({ id: "b", productId: "p-passion-1" })],
      PRODUCTS,
      CROP_NAMES
    );
    const b = rollupForOrder(
      [item({ id: "b", productId: "p-passion-1" }), item({ id: "a", productId: "p-papaya-1" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(a.crop_ft_ids).toEqual(b.crop_ft_ids);
  });

  it("ignores lines whose product is unknown to the catalogue", () => {
    const r = rollupForOrder(
      [item({ id: "a", productId: "does-not-exist" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.crop_ft_ids).toBeNull();
    expect(r.product_name).toBeNull();
  });

  it("skips a product that has no crop rather than emitting a null crop id", () => {
    const r = rollupForOrder(
      [item({ id: "a", productId: "p-nocrop" })],
      PRODUCTS,
      CROP_NAMES
    );
    expect(r.crop_ft_ids).toBeNull();
    expect(r.product_name).toBe("Mystery");
  });

  it("falls back to the crop id when its name is missing", () => {
    const r = rollupForOrder([item()], PRODUCTS, new Map());
    expect(r.crop_names).toEqual([CROP_PAPAYA]);
  });

  it("still resolves product and crop when palletCount is null", () => {
    const r = rollupForOrder([item({ palletCount: null })], PRODUCTS, CROP_NAMES);
    expect(r.product_code).toBe("920149");
    expect(r.crop_names).toEqual(["Papaya"]);
  });
});

describe("toFtOrderItemRow", () => {
  it("carries order_ft_id so lines can be joined to orders directly", () => {
    const row = toFtOrderItemRow(item(), "order-123", "2026-07-30T00:00:00.000Z");
    expect(row.order_ft_id).toBe("order-123");
    expect(row.order_version_id).toBe("v-1");
  });

  it("maps productId — the only route from an order to its crop", () => {
    expect(toFtOrderItemRow(item(), "o", "t").product_ft_id).toBe("p-papaya-1");
  });

  it("maps the pack geometry and pricing columns", () => {
    const row = toFtOrderItemRow(item(), "o", "t");
    expect(row.pallet_count).toBe(2);
    expect(row.boxes_per_pallet).toBe(104);
    expect(row.price_value).toBe(24.5);
    expect(row.price_currency).toBe("AUD");
    expect(row.price_per).toBe("BOX");
    expect(row.item_no).toBe("3207978");
    expect(row.line_no).toBe(1);
  });

  it("keeps source_modified_on null — not exposed by FreshTrack", () => {
    expect(toFtOrderItemRow(item(), "o", "t").source_modified_on).toBeNull();
  });

  it("normalises empty-string scalars to null", () => {
    const row = toFtOrderItemRow(item({ itemNo: "", priceCurrency: "" }), "o", "t");
    expect(row.item_no).toBeNull();
    expect(row.price_currency).toBeNull();
  });
});
