/**
 * Step 2: per-farm harvestLoads. Iterate over ft_entities classified as
 * farm/self_paid_farm (with a non-null farm_freshtrack_id), pull
 * harvestLoads per farm, upsert into `ft_harvest_loads`.
 *
 * Parallel chunks of 5 to bound the in-handler budget.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_HARVEST_LOADS_BY_FARM,
  type RspHarvestLoads,
  type FTHarvestLoad,
} from "@/lib/freshtrack/queries";
import {
  getWatermark,
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "harvestLoads";
const DEFAULT_LOOKBACK_DAYS = 30;
const RECURRING_LOOKBACK_DAYS = 14;
const FT_LIMIT_PER_FARM = 500;
const PARALLEL_FANOUT = 5;

export interface HarvestSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  farmsQueried: number;
  windowStart: Date;
  windowEnd: Date;
}

export async function syncHarvests(): Promise<HarvestSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const watermark = await getWatermark(STEP);
    const windowStart = computeWindowStart(watermark, runStart);
    const windowEnd = runStart;

    const farmIds = await listFarmFreshtrackIds();
    const allHarvests: Array<FTHarvestLoad & { mmGrowerFtId: string | null }> = [];
    let calls = 0;

    // Map each FT farm UUID to the MM-Hub farm row's grower_id (we need
    // this to populate ft_harvest_loads.grower_id for RLS visibility).
    const farmIdToMmFarmId = await mapFreshtrackToMmFarmIds(farmIds);

    for (let i = 0; i < farmIds.length; i += PARALLEL_FANOUT) {
      const slice = farmIds.slice(i, i + PARALLEL_FANOUT);
      const results = await Promise.all(
        slice.map((farmId) =>
          gqlQuery<RspHarvestLoads>(Q_HARVEST_LOADS_BY_FARM, {
            farmId,
            limit: FT_LIMIT_PER_FARM,
            harvestedStart: windowStart.toISOString(),
            harvestedEnd: windowEnd.toISOString(),
          }).then((r) =>
            r.harvestLoads.map((h) => ({
              ...h,
              mmGrowerFtId: farmIdToMmFarmId.get(farmId) ?? null,
            }))
          )
        )
      );
      calls += slice.length;
      for (const batch of results) allHarvests.push(...batch);
    }

    const rowsUpserted = await upsertHarvests(allHarvests);

    await advanceWatermark(STEP, runStart, {
      rowsUpserted,
      rowsSeen: allHarvests.length,
    });

    return {
      rowsUpserted,
      rowsSeen: allHarvests.length,
      graphqlCalls: calls,
      farmsQueried: farmIds.length,
      windowStart,
      windowEnd,
    };
  } catch (err) {
    await recordStepFailure(STEP, err);
    throw err;
  }
}

function computeWindowStart(watermark: Date | null, now: Date): Date {
  const ms = (watermark
    ? RECURRING_LOOKBACK_DAYS
    : DEFAULT_LOOKBACK_DAYS) * 86_400_000;
  return new Date(now.getTime() - ms);
}

async function listFarmFreshtrackIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ft_entities")
    .select("farm_freshtrack_id")
    .in("classification", ["farm", "self_paid_farm"])
    .not("farm_freshtrack_id", "is", null)
    .eq("active", true);
  if (error) throw new Error(`list ft farms: ${error.message}`);
  return (data ?? [])
    .map((r) => r.farm_freshtrack_id as string | null)
    .filter((id): id is string => id !== null);
}

/**
 * Resolve FT FarmNode.id -> our public.farms.id for RLS-scoped storage.
 * Returns an empty map for farm_freshtrack_ids that aren't yet provisioned
 * into a mm-hub farm row (super admin hasn't promoted them). The harvest
 * row still lands; grower_id is just NULL and only internal users can see
 * it via the existing RLS policy.
 */
async function mapFreshtrackToMmFarmIds(
  freshtrackFarmIds: string[]
): Promise<Map<string, string>> {
  if (freshtrackFarmIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("farms")
    .select("id, freshtrack_farm_uuid")
    .in("freshtrack_farm_uuid", freshtrackFarmIds);
  if (error) throw new Error(`map farms: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    const ftId = r.freshtrack_farm_uuid as string | null;
    if (ftId) out.set(ftId, r.id as string);
  }
  return out;
}

async function upsertHarvests(
  harvests: Array<FTHarvestLoad & { mmGrowerFtId: string | null }>
): Promise<number> {
  if (harvests.length === 0) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const payload = harvests.map((h) => ({
    freshtrack_id: h.id,
    grower_id: h.mmGrowerFtId, // RLS join target
    farm_freshtrack_id: h.farmId,
    docket_no: h.docketNo,
    planting_description: h.plantingDescription || null,
    harvested_on: h.harvestedOn,
    received_on: h.receivedOn,
    is_purchased: h.isPurchased,
    is_blended: h.isBlended,
    is_archived: h.isArchived,
    shed_id: h.shedId,
    state_id: h.stateId,
    state_name: h.stateName || null,
    supplier_id: h.supplierId,
    supplier_name: h.supplierName || null,
    block_id: h.blockId,
    block_name: h.blockName || null,
    crop_id: h.cropId,
    crop_name: h.cropName || null,
    variety_id: h.varietyId,
    variety_name: h.varietyName || null,
    subvariety_id: h.subvarietyId,
    subvariety_name: h.subvarietyName || null,
    amount_total_purchased_value: h.amountTotalPurchasedValue,
    amount_total_purchased_currency: h.amountTotalPurchasedCurrency || null,
    gross_weight_purchased_value: h.grossWeightPurchasedValue,
    gross_weight_purchased_unit: h.grossWeightPurchasedUnit || null,
    raw_json: h,
    synced_at: now,
  }));

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await admin
      .from("ft_harvest_loads")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) throw new Error(`ft_harvest_loads upsert chunk ${i}: ${error.message}`);
    upserted += slice.length;
  }
  return upserted;
}
