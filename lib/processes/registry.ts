/**
 * Maps a process_key to its runner. Adding a second process means adding one
 * entry here plus its own lib/processes/<name>/index.ts — the claim/release/
 * error-handling wrapper in runProcess() is shared.
 */
import "server-only";
import {
  claimRun,
  releaseRun,
  getProcessDefinition,
  type ProcessMode,
  type RunTrigger,
  type RunSummary,
} from "./runner";
import { runConsignorAutoAssign } from "./consignorAssign";
import { runConsignorReport } from "./runReport";

export interface ProcessRunFn {
  (ctx: {
    runId: string;
    processKey: string;
    mode: ProcessMode;
    config: Record<string, unknown>;
  }): Promise<Omit<RunSummary, "status"> & { partial?: boolean }>;
}

const REGISTRY: Record<string, ProcessRunFn> = {
  consignor_auto_assign: runConsignorAutoAssign,
  consignor_auto_assign_report: runConsignorReport,
};

export interface RunProcessResult {
  status: "success" | "partial" | "failed" | "skipped_locked" | "disabled";
  runId?: string;
  error?: string;
}

/**
 * Single entry point used by BOTH the ticked cron and the on-demand "Run now"
 * route, so a scheduled run and a manual run can never diverge in behaviour.
 */
export async function runProcess(
  processKey: string,
  trigger: RunTrigger,
  triggeredBy?: string
): Promise<RunProcessResult> {
  const def = await getProcessDefinition(processKey);
  if (!def || !def.enabled) return { status: "disabled" };

  const fn = REGISTRY[processKey];
  if (!fn) {
    throw new Error(`No runner registered for process_key '${processKey}'`);
  }

  const claim = await claimRun(processKey, trigger, def.mode, triggeredBy);
  if (!claim) return { status: "skipped_locked" };

  try {
    const result = await fn({
      runId: claim.runId,
      processKey,
      mode: def.mode,
      config: def.config,
    });
    const status = result.partial
      ? "partial"
      : result.actionsFailed > 0
        ? "failed"
        : "success";
    await releaseRun(claim.runId, { ...result, status });
    return { status, runId: claim.runId };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await releaseRun(claim.runId, {
      status: "failed",
      candidatesSeen: 0,
      actionsProposed: 0,
      actionsApplied: 0,
      actionsSkipped: 0,
      actionsFailed: 0,
      error: message,
    });
    return { status: "failed", runId: claim.runId, error: message };
  }
}
