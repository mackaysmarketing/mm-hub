/**
 * The live FreshTrack product catalogue, for the rule form's picker and for
 * turning the product codes it sends into ids. Always live — a product added
 * in FreshTrack this morning must be pickable this morning.
 */
import "server-only";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import { Q_PRODUCTS_FOR_RULES, type RspProductsForRules } from "@/lib/freshtrack/queries";
import type { LiveProduct } from "./ruleInput";

export interface PickerProduct extends LiveProduct {
  cropName: string | null;
  isActive: boolean;
  isSellable: boolean;
}

export async function loadLiveProducts(): Promise<PickerProduct[]> {
  const res = await gqlQuery<RspProductsForRules>(Q_PRODUCTS_FOR_RULES, { cropLimit: 100 });
  const cropName = new Map(res.crops.map((c) => [c.id, c.name]));
  return res.products
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      cropId: p.cropId,
      cropName: p.cropId ? (cropName.get(p.cropId) ?? null) : null,
      isActive: p.isActive,
      isSellable: p.isSellable,
    }))
    .sort((a, b) => (a.cropName ?? "~").localeCompare(b.cropName ?? "~") || a.code.localeCompare(b.code));
}
