/**
 * Per-step sync_logs writer. Tags each row with run_id + step + window so
 * the admin sync-status page can render a clean per-step history.
 *
 * `sync_logs` schema (post-migration 00010): the existing columns plus
 * step text, run_id uuid, window_start timestamptz, window_end timestamptz,
 * payload jsonb.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type StepStatus = "success" | "failed" | "skipped_for_timeout";

export interface StepResult {
  step: string;
  status: StepStatus;
  recordsSynced: number;
  recordsSeen: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  error: string | null;
  graphqlCalls: number;
  payload?: Record<string, unknown>;
}

export interface StepCtx {
  runId: string;
  source: "freshtrack";
}

export async function writeStepLog(
  ctx: StepCtx,
  result: StepResult
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("sync_logs").insert({
    source: ctx.source,
    sync_type: "incremental",
    step: result.step,
    run_id: ctx.runId,
    status: result.status,
    records_synced: result.recordsSynced,
    error_message: result.error,
    window_start: result.windowStart?.toISOString() ?? null,
    window_end: result.windowEnd?.toISOString() ?? null,
    payload: {
      records_seen: result.recordsSeen,
      graphql_calls: result.graphqlCalls,
      ...(result.payload ?? {}),
    },
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
}
