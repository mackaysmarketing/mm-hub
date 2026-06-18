/**
 * Step 1: pull FT entities and upsert into `ft_entities` (the catalogue mirror).
 *
 * IMPORTANT: this step does NOT write to `farms` or `rcti_recipients`.
 * The super admin promotes catalogue entries into customer-facing
 * grower_groups via the picker UI (commit 6). That keeps tenant composition
 * an explicit operator decision, not a side-effect of sync.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FULL,
  Q_ENTITIES_INCREMENTAL,
  type RspEntities,
  type FTEntity,
} from "@/lib/freshtrack/queries";
import { classifyBatch } from "@/lib/freshtrack/classify";
import { getWatermark, advanceWatermark, markStepStarted, recordStepFailure, type FtSyncEntityType } from "./cursor";

const ENTITY_TYPE: FtSyncEntityType = "entities";
const FT_ENTITY_LIMIT = 5_000;

export interface EntitySyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  windowStart: Date | null;
  windowEnd: Date;
  classificationBreakdown: Record<string, number>;
}

/** Pull entities (full first run; incremental thereafter) + upsert to ft_entities. */
export async function syncEntities(): Promise<EntitySyncResult> {
  const runStart = new Date();
  await markStepStarted(ENTITY_TYPE);
  try {
    const watermark = await getWatermark(ENTITY_TYPE);
    const { entities, graphqlCalls } = await fetchEntities(watermark);

    const classified = classifyBatch(entities);
    const breakdown: Record<string, number> = {};
    for (const c of classified) {
      breakdown[c.classification] = (breakdown[c.classification] ?? 0) + 1;
    }

    const rowsUpserted = await upsertEntities(classified.map((c) => ({ entity: c.entity, classification: c.classification })));

    await advanceWatermark(ENTITY_TYPE, runStart, {
      rowsUpserted,
      rowsSeen: entities.length,
    });

    return {
      rowsUpserted,
      rowsSeen: entities.length,
      graphqlCalls,
      windowStart: watermark,
      windowEnd: runStart,
      classificationBreakdown: breakdown,
    };
  } catch (err) {
    await recordStepFailure(ENTITY_TYPE, err);
    throw err;
  }
}

async function fetchEntities(
  watermark: Date | null
): Promise<{ entities: FTEntity[]; graphqlCalls: number }> {
  if (watermark === null) {
    const res = await gqlQuery<RspEntities>(Q_ENTITIES_FULL, { limit: FT_ENTITY_LIMIT });
    return { entities: res.entities, graphqlCalls: 1 };
  }
  const res = await gqlQuery<RspEntities>(Q_ENTITIES_INCREMENTAL, {
    limit: FT_ENTITY_LIMIT,
    modifiedSince: watermark.toISOString(),
  });
  return { entities: res.entities, graphqlCalls: 1 };
}

/**
 * Upsert by `freshtrack_id` (the canonical UUID key added by 00010).
 * `entity_code` and `entity_name` are kept in lock-step with the legacy
 * columns from migration 00001 so the existing RLS join on
 * `ft_entities.entity_code = farms.freshtrack_code` keeps working for
 * promoted farms.
 */
async function upsertEntities(
  rows: Array<{ entity: FTEntity; classification: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const admin = createAdminClient();

  const now = new Date().toISOString();
  const payload = rows.map(({ entity: e, classification }) => ({
    freshtrack_id: e.id,
    parent_freshtrack_id: e.parentId,
    farm_freshtrack_id: e.farmId,
    // Role-record ids (00014) — resolve dispatch consignor/consignee/carrier
    // back to this entity, and thence to a provisioned farm for grower scoping.
    consignor_freshtrack_id: e.consignorId,
    consignee_freshtrack_id: e.consigneeId,
    carrier_freshtrack_id: e.carrierId,
    is_grower: e.isGrower,
    is_consignor_active: e.isConsignorActive,
    is_consignee_active: e.isConsigneeActive,
    is_marketer_active: e.isMarketerActive,
    is_farm_active: e.isFarmActive,
    org_legal_name: e.orgLegalName || null,
    classification,
    // Legacy columns from migration 00001 — keep in sync so the existing
    // ft_entities RLS policy join (entity_code → farms.freshtrack_code) works.
    entity_code: e.code || null,
    entity_name:
      e.orgName ||
      [e.indFirstName, e.indMiddleName, e.indLastName].filter(Boolean).join(" ") ||
      null,
    entity_type: e.type || null,
    abn: e.orgTaxNo || null,
    email: e.email || null,
    phone: e.phoneNo || null,
    active: e.isActive,
    raw_json: e,
    synced_at: now,
  }));

  // Chunked upsert — Supabase JS handles ~1000-row batches well; FT today
  // returns ~200 entities, so a single batch is fine but chunking is safer
  // as the catalogue grows.
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await admin
      .from("ft_entities")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) {
      throw new Error(`ft_entities upsert failed (chunk ${i}): ${error.message}`);
    }
    upserted += slice.length;
  }
  return upserted;
}
