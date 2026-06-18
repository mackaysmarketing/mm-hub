/**
 * Step 3: pull dispatchLoads filtered by Mackays Marketing's marketerId and
 * upsert into `ft_dispatch`. Returns the dispatchLoadIds (for palletSync).
 *
 * Window strategy: default look-back is 14 days; cursor module narrows
 * subsequent runs to (last_run, now). FT does NOT expose lastModifiedOn on
 * DispatchLoadNode so we use `filterActualPickupOnStart/End` as the
 * window.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_DISPATCH_LOADS,
  type RspDispatchLoads,
  type FTDispatchLoad,
} from "@/lib/freshtrack/queries";
import {
  getWatermark,
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "dispatchLoads";
const DEFAULT_LOOKBACK_DAYS = 30; // first-run default per locked decision
const RECURRING_LOOKBACK_DAYS = 14;
const FT_LIMIT = 1_000;

export interface DispatchSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  windowStart: Date;
  windowEnd: Date;
  dispatchLoadIds: string[];
}

export async function syncDispatch(): Promise<DispatchSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const watermark = await getWatermark(STEP);
    const windowStart = computeWindowStart(watermark, runStart);
    const windowEnd = runStart;

    const marketerId = requireMarketerId();
    const res = await gqlQuery<RspDispatchLoads>(Q_DISPATCH_LOADS, {
      marketerId,
      limit: FT_LIMIT,
      pickupStart: windowStart.toISOString(),
      pickupEnd: windowEnd.toISOString(),
    });
    const dispatches = res.dispatchLoads;

    // Resolve each dispatch's consignor → provisioned farm for grower scoping.
    const consignorIds = Array.from(
      new Set(dispatches.map((d) => d.consignorId).filter(Boolean))
    ) as string[];
    const consignorToFarm = await mapConsignorsToFarms(consignorIds);

    const rowsUpserted = await upsertDispatches(dispatches, consignorToFarm);

    await advanceWatermark(STEP, runStart, {
      rowsUpserted,
      rowsSeen: dispatches.length,
    });

    return {
      rowsUpserted,
      rowsSeen: dispatches.length,
      graphqlCalls: 1,
      windowStart,
      windowEnd,
      dispatchLoadIds: dispatches.map((d) => d.id),
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
  // Always include lookback overlap so retroactive edits are caught.
  return new Date(now.getTime() - ms);
}

/**
 * Resolve dispatch consignor role-ids → mm-hub farm ids, via:
 *   dispatch.consignorId → ft_entities.consignor_freshtrack_id
 *     → ft_entities.freshtrack_id → farms.freshtrack_entity_uuid → farms.id
 * Only provisioned farms resolve; DC/marketer consignors return no entry
 * (their dispatches stay grower_id NULL — internal-only via RLS).
 */
async function mapConsignorsToFarms(
  consignorIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (consignorIds.length === 0) return out;
  const admin = createAdminClient();

  const { data: ents, error: entErr } = await admin
    .from("ft_entities")
    .select("consignor_freshtrack_id, freshtrack_id")
    .in("consignor_freshtrack_id", consignorIds);
  if (entErr) throw new Error(`map consignors (entities): ${entErr.message}`);

  const entityToConsignor = new Map<string, string>(); // freshtrack_id → consignor id
  const entityIds: string[] = [];
  for (const e of ents ?? []) {
    const fid = e.freshtrack_id as string | null;
    const cid = e.consignor_freshtrack_id as string | null;
    if (fid && cid) {
      entityToConsignor.set(fid, cid);
      entityIds.push(fid);
    }
  }
  if (entityIds.length === 0) return out;

  const { data: farms, error: farmErr } = await admin
    .from("farms")
    .select("id, freshtrack_entity_uuid")
    .in("freshtrack_entity_uuid", entityIds);
  if (farmErr) throw new Error(`map consignors (farms): ${farmErr.message}`);

  for (const f of farms ?? []) {
    const entityId = f.freshtrack_entity_uuid as string | null;
    if (!entityId) continue;
    const consignorId = entityToConsignor.get(entityId);
    if (consignorId) out.set(consignorId, f.id as string);
  }
  return out;
}

function requireMarketerId(): string {
  const id = process.env.FT_MACKM_MARKETER_ID;
  if (!id) {
    throw new Error(
      "FT_MACKM_MARKETER_ID not set — Mackays Marketing marketerId required to filter dispatches"
    );
  }
  return id;
}

async function upsertDispatches(
  dispatches: FTDispatchLoad[],
  consignorToFarm: Map<string, string>
): Promise<number> {
  if (dispatches.length === 0) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const payload = dispatches.map((d) => ({
    freshtrack_id: d.id,
    grower_id: d.consignorId ? consignorToFarm.get(d.consignorId) ?? null : null,
    order_type: d.orderType,
    scheduled_pickup_on: d.scheduledPickupOn,
    actual_pickup_on: d.actualPickupOn,
    scheduled_delivery_on: d.scheduledDeliveryOn,
    actual_delivery_on: d.actualDeliveryOn,
    pack_date: d.packDate,
    manifest_no: d.manifestNo || null,
    certificate_no: d.certificateNo || null,
    dc_slot_ref: d.dcSlotRef || null,
    order_no: d.orderNo || null,
    sales_order_no: d.salesOrderNo || null,
    po_no: d.poNo || null,
    stock_boxes: d.stockBoxes,
    reconsigned_boxes: d.reconsignedBoxes,
    rejected_boxes: d.rejectedBoxes,
    repacked_boxes: d.repackedBoxes,
    waste_boxes: d.wasteBoxes,
    temperature_value: d.temperatureValue,
    temperature_unit: d.temperatureUnit || null,
    is_complete: d.isComplete,
    asn_sent_on: d.asnSentOn,
    email_sent_on: d.emailSentOn,
    consignor_ft_id: d.consignorId,
    consignee_ft_id: d.consigneeId,
    marketer_ft_id: d.marketerId,
    carrier_ft_id: d.carrierId,
    // Legacy compat from migration 00001:
    load_number: d.loadNo || null,
    dispatch_date: d.actualPickupOn ?? d.scheduledPickupOn ?? null,
    status: d.isComplete ? "complete" : "pending",
    raw_json: d,
    synced_at: now,
  }));

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await admin
      .from("ft_dispatch")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) throw new Error(`ft_dispatch upsert chunk ${i}: ${error.message}`);
    upserted += slice.length;
  }
  return upserted;
}
