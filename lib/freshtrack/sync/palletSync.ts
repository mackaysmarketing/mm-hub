/**
 * Step 4: per-dispatch pallet fan-out. Pull pallets per dispatchLoadId from
 * Step 3, upsert into `ft_pallets`. Parallel chunks of 5 to keep within
 * the 270s in-handler budget.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import { Q_PALLETS_BY_DISPATCH, type RspPallets, type FTPallet } from "@/lib/freshtrack/queries";
import {
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "pallets";
const FT_LIMIT_PER_DISPATCH = 500;
const PARALLEL_FANOUT = 5;

export interface PalletSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  dispatchesQueried: number;
}

export async function syncPallets(dispatchLoadIds: string[]): Promise<PalletSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const allPallets: FTPallet[] = [];
    const dispatchSet = new Set<string>(dispatchLoadIds);
    let calls = 0;

    // Parallel fan-out in chunks so we don't hammer FT or exhaust connections.
    const ids = Array.from(dispatchSet);
    for (let i = 0; i < ids.length; i += PARALLEL_FANOUT) {
      const slice = ids.slice(i, i + PARALLEL_FANOUT);
      const results = await Promise.all(
        slice.map((id) =>
          gqlQuery<RspPallets>(Q_PALLETS_BY_DISPATCH, {
            dispatchLoadId: id,
            limit: FT_LIMIT_PER_DISPATCH,
          }).then((r) => r.pallets.map((p) => ({ ...p, dispatchLoadId: id })))
        )
      );
      calls += slice.length;
      for (const batch of results) allPallets.push(...(batch as FTPallet[]));
    }

    const rowsUpserted = await upsertPallets(allPallets);

    await advanceWatermark(STEP, runStart, {
      rowsUpserted,
      rowsSeen: allPallets.length,
    });

    return {
      rowsUpserted,
      rowsSeen: allPallets.length,
      graphqlCalls: calls,
      dispatchesQueried: dispatchSet.size,
    };
  } catch (err) {
    await recordStepFailure(STEP, err);
    throw err;
  }
}

async function upsertPallets(pallets: FTPallet[]): Promise<number> {
  if (pallets.length === 0) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const payload = pallets.map((p) => ({
    freshtrack_id: p.id,
    dispatch_load_ft_id: p.dispatchLoadId,
    harvest_load_ft_id: p.harvestLoadId,
    pallet_no: p.palletNo || null,
    packed_on: p.packedOn,
    loaded_on: p.loadedOn,
    best_before: p.bestBefore,
    stock_boxes: p.stockBoxes,
    reconsigned_boxes: p.reconsignedBoxes,
    rejected_boxes: p.rejectedBoxes,
    repacked_boxes: p.repackedBoxes,
    waste_boxes: p.wasteBoxes,
    net_weight_value: p.netWeightValue,
    net_weight_unit: p.netWeightUnit || null,
    gross_weight_value: p.grossWeightValue,
    gross_weight_unit: p.grossWeightUnit || null,
    product_description: p.productDescription || null,
    crop_description: p.cropDescription || null,
    variety_description: p.varietyDescription || null,
    is_archived: p.isArchived,
    raw_json: p,
    synced_at: now,
  }));

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await admin
      .from("ft_pallets")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) throw new Error(`ft_pallets upsert chunk ${i}: ${error.message}`);
    upserted += slice.length;
  }
  return upserted;
}
