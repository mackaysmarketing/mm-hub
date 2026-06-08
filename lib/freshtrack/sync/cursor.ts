/**
 * Per-entity-type watermark cursor backed by `public.ft_sync_state`.
 *
 * Why: most FreshTrack nodes (EntityNode, DispatchLoadNode, HarvestLoadNode,
 * PalletNode, OrderNode, BoxNode) expose `filterLastModifiedOnStart` as a
 * query ARG but NOT as a selectable field — so the only durable watermark
 * is what we pass to the next call. We persist it in ft_sync_state and
 * advance ONLY on full step success.
 *
 * ChargeAppliedNode is the exception (exposes lastModifiedOn on the row).
 * For charges we also store `source_modified_on` per row.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type FtSyncEntityType =
  | "entities"
  | "dispatchLoads"
  | "pallets"
  | "chargesApplied"
  | "harvestLoads"
  | "orders"
  | "orderItems"
  | "boxes";

export interface FtSyncCursorRow {
  entity_type: FtSyncEntityType;
  last_modified_cursor: string | null; // timestamptz ISO
  last_run_started_at: string | null;
  last_run_completed_at: string | null;
  last_run_status: "running" | "success" | "failed" | "skipped_for_timeout" | null;
  last_error: string | null;
  rows_upserted: number;
  rows_seen: number;
}

/** Read the current watermark for an entity type. NULL means "never synced". */
export async function getWatermark(
  type: FtSyncEntityType
): Promise<Date | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ft_sync_state")
    .select("last_modified_cursor")
    .eq("entity_type", type)
    .maybeSingle();
  if (error || !data || !data.last_modified_cursor) return null;
  return new Date(data.last_modified_cursor as string);
}

/** Advance the watermark + record step-success metadata. */
export async function advanceWatermark(
  type: FtSyncEntityType,
  to: Date,
  metrics: { rowsUpserted: number; rowsSeen: number }
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ft_sync_state").upsert(
    {
      entity_type: type,
      last_modified_cursor: to.toISOString(),
      last_run_completed_at: new Date().toISOString(),
      last_run_status: "success",
      last_error: null,
      rows_upserted: metrics.rowsUpserted,
      rows_seen: metrics.rowsSeen,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity_type" }
  );
}

/** Record a step failure WITHOUT advancing the cursor — the next run retries. */
export async function recordStepFailure(
  type: FtSyncEntityType,
  err: unknown
): Promise<void> {
  const admin = createAdminClient();
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  await admin.from("ft_sync_state").upsert(
    {
      entity_type: type,
      last_run_completed_at: new Date().toISOString(),
      last_run_status: "failed",
      last_error: msg.slice(0, 2000),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity_type" }
  );
}

/** Stamp the "running" status at step start (so admin UI can show progress). */
export async function markStepStarted(type: FtSyncEntityType): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ft_sync_state").upsert(
    {
      entity_type: type,
      last_run_started_at: new Date().toISOString(),
      last_run_status: "running",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity_type" }
  );
}

/**
 * Wrap a step: mark started, run, advance on success OR record failure. The
 * cursor advances to `nextCursor` (typically the start-time of THIS run, so
 * the next run picks up everything modified since) only when fn() returns
 * cleanly.
 */
export async function withCursor<T>(
  type: FtSyncEntityType,
  nextCursorAt: Date,
  fn: () => Promise<{ value: T; rowsUpserted: number; rowsSeen: number }>
): Promise<T> {
  await markStepStarted(type);
  try {
    const result = await fn();
    await advanceWatermark(type, nextCursorAt, {
      rowsUpserted: result.rowsUpserted,
      rowsSeen: result.rowsSeen,
    });
    return result.value;
  } catch (err) {
    await recordStepFailure(type, err);
    throw err;
  }
}
