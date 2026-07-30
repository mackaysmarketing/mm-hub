/**
 * Resolve FreshTrack consignor ROLE ids → mm-hub `farms.id`, for grower
 * scoping (RLS) on synced rows.
 *
 *   consignorId → ft_entities.consignor_freshtrack_id
 *     → ft_entities.freshtrack_id → farms.freshtrack_entity_uuid → farms.id
 *
 * Only provisioned farms resolve. Distribution-centre / ripening-centre /
 * marketer consignors deliberately return no entry, so their rows keep
 * grower_id NULL and stay internal-only under RLS.
 *
 * Extracted verbatim in behaviour from dispatchSync.mapConsignorsToFarms so
 * orderSync doesn't fork a second copy. dispatchSync still has its private
 * version — switching it to import this is a safe follow-up, intentionally
 * left out of the Phase 1 diff so the change surface is new code only.
 *
 * CAVEAT worth knowing: this reads `ft_entities`, which as of 2026-07-30 is
 * incomplete — the entities sync step reports a constant 17 rows/day and is
 * missing at least SQBRL ("SQBR - Location"). An unresolved consignor is
 * indistinguishable here from a legitimately non-farm consignor, so a stale
 * ft_entities silently yields grower_id NULL rather than an error. That is the
 * safe direction (row stays internal-only) but it is NOT self-announcing —
 * hence `unresolved` on the result so callers can log the count.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ConsignorFarmMap {
  /** consignor role id → farms.id */
  byConsignorId: Map<string, string>;
  /** consignor role ids that matched no provisioned farm (expected for DCs). */
  unresolved: string[];
}

export async function mapConsignorsToFarms(
  consignorIds: (string | null | undefined)[]
): Promise<ConsignorFarmMap> {
  const ids = Array.from(
    new Set(consignorIds.filter((x): x is string => Boolean(x)))
  );
  const byConsignorId = new Map<string, string>();
  if (ids.length === 0) return { byConsignorId, unresolved: [] };

  const admin = createAdminClient();

  const { data: ents, error: entErr } = await admin
    .from("ft_entities")
    .select("consignor_freshtrack_id, freshtrack_id")
    .in("consignor_freshtrack_id", ids);
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

  if (entityIds.length > 0) {
    const { data: farms, error: farmErr } = await admin
      .from("farms")
      .select("id, freshtrack_entity_uuid")
      .in("freshtrack_entity_uuid", entityIds);
    if (farmErr) throw new Error(`map consignors (farms): ${farmErr.message}`);

    for (const f of farms ?? []) {
      const entityId = f.freshtrack_entity_uuid as string | null;
      if (!entityId) continue;
      const consignorId = entityToConsignor.get(entityId);
      if (consignorId) byConsignorId.set(consignorId, f.id as string);
    }
  }

  return {
    byConsignorId,
    unresolved: ids.filter((id) => !byConsignorId.has(id)),
  };
}

/**
 * consignee ROLE id → { code, name } from ft_entities, for the legacy
 * `ft_orders.customer_code` / `customer_name` columns that
 * app/api/orders/route.ts searches on.
 */
export async function mapConsigneesToNames(
  consigneeIds: (string | null | undefined)[]
): Promise<Map<string, { code: string | null; name: string | null }>> {
  const ids = Array.from(
    new Set(consigneeIds.filter((x): x is string => Boolean(x)))
  );
  const out = new Map<string, { code: string | null; name: string | null }>();
  if (ids.length === 0) return out;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ft_entities")
    .select("consignee_freshtrack_id, entity_code, entity_name")
    .in("consignee_freshtrack_id", ids);
  if (error) throw new Error(`map consignees: ${error.message}`);

  for (const e of data ?? []) {
    const cid = e.consignee_freshtrack_id as string | null;
    if (!cid) continue;
    out.set(cid, {
      code: (e.entity_code as string | null) ?? null,
      name: (e.entity_name as string | null) ?? null,
    });
  }
  return out;
}
