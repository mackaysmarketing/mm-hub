/**
 * GET /api/cron/sync-freshtrack — Vercel cron orchestrator for the GraphQL sync.
 *
 * Gated behind FRESHTRACK_GRAPHQL_SYNC_ENABLED (default off). Returns
 * {status:"disabled"} until the flag is "true" so a misconfigured deploy
 * is a no-op instead of a partial run.
 *
 * Concurrency: claim_freshtrack_run() (advisory lock + sync_logs row) so
 * two cron triggers can't race. Stale running rows >15 min are reaped.
 *
 * Budget: 270s in-handler ceiling (with 30s safety vs Vercel maxDuration=300).
 * Per-step budgets prevent any single step from starving the others.
 * Steps that run out of budget record status="skipped_for_timeout" and do
 * NOT advance their watermark — the next run resumes the same window.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeStepLog, type StepCtx, type StepResult } from "@/lib/freshtrack/sync/logger";
import { syncEntities } from "@/lib/freshtrack/sync/entitySync";
import { syncDispatch } from "@/lib/freshtrack/sync/dispatchSync";
import { syncPallets } from "@/lib/freshtrack/sync/palletSync";
import { syncHarvests } from "@/lib/freshtrack/sync/harvestSync";
import { syncCharges } from "@/lib/freshtrack/sync/chargeSync";
import {
  AuthCredentialsError,
  ConfigError,
  GraphQLAppError,
  PermanentAuthError,
} from "@/lib/freshtrack-graphql";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HANDLER_BUDGET_MS = 270_000;
const PER_STEP_BUDGETS_MS: Record<string, number> = {
  entities: 30_000,
  harvests: 90_000,
  dispatch: 60_000,
  pallets: 60_000,
  charges: 30_000,
};

interface StepRunResult {
  step: string;
  status: "success" | "failed" | "skipped_for_timeout" | "skipped_for_dependency";
  recordsSynced: number;
  recordsSeen: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  error: string | null;
  graphqlCalls: number;
  payload?: Record<string, unknown>;
  fatal?: boolean;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  // 1. CRON_SECRET (unchanged from old route).
  if (process.env.NODE_ENV !== "development") {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 2. Feature flag — pattern mirrors the NetSuite cron (baeaa72).
  if (process.env.FRESHTRACK_GRAPHQL_SYNC_ENABLED !== "true") {
    return NextResponse.json({
      status: "disabled",
      reason:
        "FreshTrack GraphQL sync is gated by FRESHTRACK_GRAPHQL_SYNC_ENABLED. Set to 'true' to enable.",
    });
  }

  const admin = createAdminClient();

  // 3. Concurrency claim — advisory lock + sync_logs row, single txn.
  let runId: string | null = null;
  try {
    const { data, error } = await admin.rpc("claim_freshtrack_run");
    if (error) throw error;
    runId = data as string | null;
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        reason: "claim failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
  if (!runId) {
    return NextResponse.json({
      status: "skipped",
      reason: "another freshtrack run is in progress",
    });
  }

  const ctx: StepCtx = { runId, source: "freshtrack" };
  const stepResults: StepRunResult[] = [];

  try {
    // ---- Step 1: entities (always runs; everything downstream depends on it).
    const stepCtx = await runStep("entities", PER_STEP_BUDGETS_MS.entities, startTime, async () => {
      const r = await syncEntities();
      return {
        recordsSynced: r.rowsUpserted,
        recordsSeen: r.rowsSeen,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        graphqlCalls: r.graphqlCalls,
        payload: { classification_breakdown: r.classificationBreakdown },
      };
    });
    stepResults.push(stepCtx);
    if (stepCtx.fatal) {
      await writeStepLog(ctx, toStepResult(stepCtx));
      return await finalize(admin, runId, "failed", stepResults, stepCtx.error, startTime);
    }
    await writeStepLog(ctx, toStepResult(stepCtx));

    // ---- Step 2: per-farm harvests (independent of dispatch — could parallelize later).
    const harvestStep = await runStep("harvests", PER_STEP_BUDGETS_MS.harvests, startTime, async () => {
      const r = await syncHarvests();
      return {
        recordsSynced: r.rowsUpserted,
        recordsSeen: r.rowsSeen,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        graphqlCalls: r.graphqlCalls,
        payload: { farms_queried: r.farmsQueried },
      };
    });
    stepResults.push(harvestStep);
    await writeStepLog(ctx, toStepResult(harvestStep));
    // harvest failure is non-fatal — dispatch + pallets + charges still run

    // ---- Step 3: dispatch (returns dispatchLoadIds for Step 4).
    let dispatchLoadIds: string[] = [];
    const dispatchStep = await runStep("dispatch", PER_STEP_BUDGETS_MS.dispatch, startTime, async () => {
      const r = await syncDispatch();
      dispatchLoadIds = r.dispatchLoadIds;
      return {
        recordsSynced: r.rowsUpserted,
        recordsSeen: r.rowsSeen,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        graphqlCalls: r.graphqlCalls,
      };
    });
    stepResults.push(dispatchStep);
    await writeStepLog(ctx, toStepResult(dispatchStep));

    // ---- Step 4: pallets (per dispatch fan-out). Skipped if dispatch failed.
    if (dispatchStep.status === "success" && dispatchLoadIds.length > 0) {
      const palletStep = await runStep("pallets", PER_STEP_BUDGETS_MS.pallets, startTime, async () => {
        const r = await syncPallets(dispatchLoadIds);
        return {
          recordsSynced: r.rowsUpserted,
          recordsSeen: r.rowsSeen,
          windowStart: null,
          windowEnd: null,
          graphqlCalls: r.graphqlCalls,
          payload: { dispatches_queried: r.dispatchesQueried },
        };
      });
      stepResults.push(palletStep);
      await writeStepLog(ctx, toStepResult(palletStep));
    } else {
      const skipped: StepRunResult = {
        step: "pallets",
        status: "skipped_for_dependency",
        recordsSynced: 0,
        recordsSeen: 0,
        windowStart: null,
        windowEnd: null,
        error: dispatchStep.status !== "success"
          ? `dispatch did not succeed (${dispatchStep.status})`
          : "no dispatchLoadIds to fan out",
        graphqlCalls: 0,
      };
      stepResults.push(skipped);
      await writeStepLog(ctx, toStepResult(skipped));
    }

    // ---- Step 5: charges (independent window).
    const chargeStep = await runStep("charges", PER_STEP_BUDGETS_MS.charges, startTime, async () => {
      const r = await syncCharges();
      return {
        recordsSynced: r.rowsUpserted,
        recordsSeen: r.rowsSeen,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        graphqlCalls: r.graphqlCalls,
      };
    });
    stepResults.push(chargeStep);
    await writeStepLog(ctx, toStepResult(chargeStep));

    // ---- Finalize. Run is "success" only if ALL steps succeeded; otherwise "partial".
    const anyFailed = stepResults.some((s) => s.status === "failed" || s.fatal);
    const allOk = stepResults.every((s) => s.status === "success");
    const overallStatus = allOk ? "success" : anyFailed ? "failed" : "partial";
    return await finalize(admin, runId, overallStatus, stepResults, null, startTime);
  } catch (err) {
    // Top-level unexpected error — release the lock + surface.
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return await finalize(admin, runId, "failed", stepResults, msg, startTime);
  }
}

/** Run a single step with a time budget; classify failures by error type. */
async function runStep(
  name: string,
  budgetMs: number,
  startTime: number,
  fn: () => Promise<{
    recordsSynced: number;
    recordsSeen: number;
    windowStart: Date | null;
    windowEnd: Date | null;
    graphqlCalls: number;
    payload?: Record<string, unknown>;
  }>
): Promise<StepRunResult> {
  const elapsedMs = Date.now() - startTime;
  if (elapsedMs + budgetMs > HANDLER_BUDGET_MS) {
    return {
      step: name,
      status: "skipped_for_timeout",
      recordsSynced: 0,
      recordsSeen: 0,
      windowStart: null,
      windowEnd: null,
      error: `step skipped: handler budget would exceed ${HANDLER_BUDGET_MS}ms`,
      graphqlCalls: 0,
    };
  }
  try {
    const r = await fn();
    return {
      step: name,
      status: "success",
      recordsSynced: r.recordsSynced,
      recordsSeen: r.recordsSeen,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      error: null,
      graphqlCalls: r.graphqlCalls,
      payload: r.payload,
    };
  } catch (err) {
    const fatal =
      err instanceof AuthCredentialsError ||
      err instanceof PermanentAuthError ||
      err instanceof ConfigError ||
      err instanceof GraphQLAppError;
    return {
      step: name,
      status: "failed",
      recordsSynced: 0,
      recordsSeen: 0,
      windowStart: null,
      windowEnd: null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      graphqlCalls: 0,
      fatal,
    };
  }
}

function toStepResult(s: StepRunResult): StepResult {
  // logger.ts accepts a narrower status set.
  const status = s.status === "success" || s.status === "failed" || s.status === "skipped_for_timeout"
    ? s.status
    : "failed";
  return {
    step: s.step,
    status,
    recordsSynced: s.recordsSynced,
    recordsSeen: s.recordsSeen,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    error: s.error,
    graphqlCalls: s.graphqlCalls,
    payload: s.payload,
  };
}

async function finalize(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  status: string,
  steps: StepRunResult[],
  topLevelError: string | null,
  startTime: number
) {
  const totalRecords = steps.reduce((s, x) => s + x.recordsSynced, 0);
  try {
    await admin.rpc("release_freshtrack_run", {
      p_run_id: runId,
      p_status: status,
      p_records: totalRecords,
      p_error: topLevelError,
    });
  } catch {
    // Release failure is non-fatal; the stale-run reaper handles it.
  }
  return NextResponse.json({
    status,
    runId,
    duration: Date.now() - startTime,
    totalRecords,
    steps,
    ...(topLevelError ? { error: topLevelError } : {}),
  });
}
