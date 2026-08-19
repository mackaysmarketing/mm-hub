/**
 * Settings and DC mapping loaders.
 *
 * Both live in Postgres, not in code, so a tolerance change or a newly
 * confirmed DC is an admin edit rather than a deploy. A run freezes a copy of
 * the settings it used into price_verification_runs.settings — changing the
 * policy later must not silently rewrite what an old report meant.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SETTINGS, type DcMapping, type Retailer, type VerificationSettings } from "./types";

export interface StoredSettings extends VerificationSettings {
  writeBackEnabled: boolean;
  updatedAt: string | null;
}

export async function loadSettings(): Promise<StoredSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("price_verification_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!data) {
    return { ...DEFAULT_SETTINGS, writeBackEnabled: false, updatedAt: null };
  }

  return {
    tolerance: Number(data.tolerance ?? 0),
    verifiableStates: (data.verifiable_states as string[]) ?? DEFAULT_SETTINGS.verifiableStates,
    skipStates: (data.skip_states as string[]) ?? DEFAULT_SETTINGS.skipStates,
    unapprovedQuotes:
      (data.unapproved_quotes as "use" | "skip") ?? DEFAULT_SETTINGS.unapprovedQuotes,
    writeBackEnabled: Boolean(data.write_back_enabled),
    updatedAt: (data.updated_at as string) ?? null,
  };
}

export async function saveSettings(
  patch: Partial<VerificationSettings>,
  userId: string
): Promise<StoredSettings> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userId };

  if (patch.tolerance !== undefined) update.tolerance = patch.tolerance;
  if (patch.verifiableStates !== undefined) update.verifiable_states = patch.verifiableStates;
  if (patch.skipStates !== undefined) update.skip_states = patch.skipStates;
  if (patch.unapprovedQuotes !== undefined) update.unapproved_quotes = patch.unapprovedQuotes;

  const { error } = await admin
    .from("price_verification_settings")
    .update(update)
    .eq("id", 1);
  if (error) throw new Error(`could not save settings: ${error.message}`);

  return loadSettings();
}

/** DC mappings for one retailer, with the avocado-variant entities attached. */
export async function loadDcMappings(retailer?: Retailer): Promise<DcMapping[]> {
  const admin = createAdminClient();

  let query = admin
    .from("retailer_dc_map")
    .select("id, retailer, dc_code, dc_label, entity_code, active, notes")
    .order("retailer")
    .order("dc_code");
  if (retailer) query = query.eq("retailer", retailer);

  const { data: rows, error } = await query;
  if (error) throw new Error(`could not load DC mappings: ${error.message}`);

  const ids = (rows ?? []).map((r) => r.id as string);
  const altByMap = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: alts } = await admin
      .from("retailer_dc_alt_entities")
      .select("dc_map_id, entity_code")
      .in("dc_map_id", ids);
    for (const a of alts ?? []) {
      const key = a.dc_map_id as string;
      altByMap.set(key, [...(altByMap.get(key) ?? []), a.entity_code as string]);
    }
  }

  return (rows ?? []).map((r) => ({
    retailer: r.retailer as Retailer,
    dcCode: r.dc_code as string,
    dcLabel: (r.dc_label as string) ?? null,
    entityCode: (r.entity_code as string) ?? null,
    altEntityCodes: altByMap.get(r.id as string) ?? [],
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  }));
}

export async function updateDcMapping(
  retailer: Retailer,
  dcCode: string,
  patch: { entityCode?: string | null; dcLabel?: string | null; active?: boolean; notes?: string | null }
): Promise<void> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.entityCode !== undefined) update.entity_code = patch.entityCode || null;
  if (patch.dcLabel !== undefined) update.dc_label = patch.dcLabel;
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const { error } = await admin
    .from("retailer_dc_map")
    .update(update)
    .eq("retailer", retailer)
    .eq("dc_code", dcCode);
  if (error) throw new Error(`could not update DC mapping: ${error.message}`);
}

/**
 * Adds a DC code seen in an uploaded quote that has no mapping row yet, so it
 * shows up in the admin UI as something to resolve rather than vanishing.
 */
export async function ensureDcRowsExist(
  retailer: Retailer,
  dcCodes: string[]
): Promise<void> {
  if (dcCodes.length === 0) return;
  const admin = createAdminClient();
  await admin.from("retailer_dc_map").upsert(
    dcCodes.map((dc) => ({
      retailer,
      dc_code: dc,
      entity_code: null,
      notes: "Seen in an uploaded quote file with no mapping — needs an entity.",
    })),
    { onConflict: "retailer,dc_code", ignoreDuplicates: true }
  );
}

/** The entity codes a verification should fetch orders for. */
export function entityCodesFor(mappings: DcMapping[]): string[] {
  const codes = new Set<string>();
  for (const m of mappings) {
    if (!m.active) continue;
    if (m.entityCode) codes.add(m.entityCode);
    for (const alt of m.altEntityCodes) codes.add(alt);
  }
  return Array.from(codes);
}
