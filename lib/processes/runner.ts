/**
 * Generic process runner: claim (mutual exclusion), release, and action
 * logging shared by every process under lib/processes/*.
 *
 * Locking: a plain UNIQUE partial index on
 * process_runs(process_key) WHERE status = 'running' (migration 00017) —
 * NOT the session-scoped pg_advisory_lock the FreshTrack cron uses, which is
 * unsound under Supabase's connection pooler. Claiming is just an INSERT that
 * either succeeds or hits a unique-violation (Postgres 23505); Postgres
 * itself is the source of truth for "is something already running", so it is
 * correct no matter which pooled connection makes the call.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const STALE_RUN_MINUTES = 15;
const UNIQUE_VIOLATION = "23505";

export type ProcessMode = "dry_run" | "apply";
export type RunTrigger = "cron" | "manual";
export type RunStatus = "running" | "success" | "partial" | "failed" | "skipped_locked";

export interface ProcessDefinitionRow {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  mode: ProcessMode;
  config: Record<string, unknown>;
}

export async function getProcessDefinition(
  key: string
): Promise<ProcessDefinitionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .select("key, name, description, enabled, mode, config")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`getProcessDefinition(${key}): ${error.message}`);
  return (data as ProcessDefinitionRow | null) ?? null;
}

export interface ClaimResult {
  runId: string;
}

/**
 * Reap any stale 'running' row for this process, then attempt to claim a new
 * run. Returns null if another run is genuinely in progress (still within the
 * stale window) — the caller should treat that as 'skipped_locked' and stop.
 */
export async function claimRun(
  processKey: string,
  trigger: RunTrigger,
  mode: ProcessMode,
  triggeredBy?: string
): Promise<ClaimResult | null> {
  const admin = createAdminClient();

  await admin
    .from("process_runs")
    .update({
      status: "failed",
      error: "killed_by_timeout",
      completed_at: new Date().toISOString(),
    })
    .eq("process_key", processKey)
    .eq("status", "running")
    .lt(
      "started_at",
      new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString()
    );

  const { data, error } = await admin
    .from("process_runs")
    .insert({
      process_key: processKey,
      trigger,
      mode,
      triggered_by: triggeredBy ?? null,
      status: "running",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null; // another run holds the slot
    throw new Error(`claimRun(${processKey}): ${error.message}`);
  }
  return { runId: data.id as string };
}

export interface RunSummary {
  status: Exclude<RunStatus, "running" | "skipped_locked">;
  candidatesSeen: number;
  actionsProposed: number;
  actionsApplied: number;
  actionsSkipped: number;
  actionsFailed: number;
  error?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Delete a claimed run that turned out not to be due after all — see the
 * post-claim re-check in registry.runProcess(). The row is removed rather than
 * released with a status because the process never started: leaving it would
 * put a phantom entry in the activity log and, worse, advance the lastRunAt
 * that due-ness is measured from.
 */
export async function discardRun(runId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("process_runs").delete().eq("id", runId);
  if (error) throw new Error(`discardRun(${runId}): ${error.message}`);
}

export async function releaseRun(runId: string, summary: RunSummary): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("process_runs")
    .update({
      status: summary.status,
      completed_at: new Date().toISOString(),
      candidates_seen: summary.candidatesSeen,
      actions_proposed: summary.actionsProposed,
      actions_applied: summary.actionsApplied,
      actions_skipped: summary.actionsSkipped,
      actions_failed: summary.actionsFailed,
      error: summary.error ?? null,
      payload: summary.payload ?? null,
    })
    .eq("id", runId);
  if (error) throw new Error(`releaseRun(${runId}): ${error.message}`);
}

export interface ActionLogInput {
  runId: string;
  processKey: string;
  targetType: string;
  targetId: string;
  targetRef?: string | null;
  consigneeName?: string | null;
  action: string;
  status: "proposed" | "applied" | "skipped" | "failed";
  skipReason?: string | null;
  ruleId?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  error?: string | null;
}

export async function logAction(input: ActionLogInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("process_actions").insert({
    run_id: input.runId,
    process_key: input.processKey,
    target_type: input.targetType,
    target_id: input.targetId,
    target_ref: input.targetRef ?? null,
    consignee_name: input.consigneeName ?? null,
    action: input.action,
    status: input.status,
    skip_reason: input.skipReason ?? null,
    rule_id: input.ruleId ?? null,
    before: input.before,
    after: input.after,
    error: input.error ?? null,
    applied_at: input.status === "applied" ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`logAction(${input.processKey}): ${error.message}`);
}
