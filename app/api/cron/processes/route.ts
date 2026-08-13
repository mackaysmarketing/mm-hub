/**
 * GET /api/cron/processes — the tick-pattern cron for admin-configurable
 * background processes (design doc §7).
 *
 * Vercel crons are UTC-only and defined in vercel.json, which can't be
 * changed without a redeploy — incompatible with the Tools UI's "manage run
 * schedule" ask. So this ONE fixed cron ticks every 5 minutes and, on each
 * tick, checks every enabled process_definitions row against its OWN
 * config.schedule (isRunDue). Editing the schedule in the UI is then just an
 * update to that jsonb column — no redeploy, no vercel.json change.
 *
 * The tick interval is the floor and the step for every schedule the UI can
 * express: nothing can run more often than the cron fires. It is duplicated as
 * TICK_MINUTES in lib/processes/schedule.ts, which nothing can verify at build
 * time — change both together. A tick this frequent is affordable because the
 * common path is two small indexed selects and an early return: work only
 * happens on the ticks where a process is actually due.
 *
 * DUE-NESS IS ELAPSED TIME, NOT THE CLOCK. This route hands isRunDue the
 * started_at of each process's last completed run, and due-ness is measured
 * from that. It deliberately does NOT ask "is the current minute a slot" —
 * Vercel does not guarantee a cron lands on the minute, and when that check
 * existed a tick arriving at :01 instead of :00 silently ran nothing while
 * still returning 200. See SPRINT.md (2026-08-13).
 *
 * "Run now" (app/api/processes/[key]/run) calls the exact same runProcess()
 * function directly, bypassing the schedule check, so a manual run and a
 * scheduled run can never diverge in behaviour. It does not consult
 * lastSuccessAt either — an on-demand run is always intentional.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runProcess } from "@/lib/processes/registry";
import {
  parseSchedule,
  isRunDue,
  TERMINAL_RUN_STATUSES,
} from "@/lib/processes/schedule";

export const dynamic = "force-dynamic";
// Belt-and-braces alongside the no-store fetch in createAdminClient(): this
// route reads its schedule/mode/enabled state from process_definitions and
// must never see a cached snapshot of it. `dynamic` alone does not opt fetches
// out of the Data Cache, and unlike the UI routes this one never calls a
// dynamic function (it reads request.headers, not headers()), so it gets no
// implicit opt-out either.
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .select("key, config")
    .eq("enabled", true)
    // Deterministic order: which process is judged first must not depend on
    // Postgres row order, since the earlier one consumes wall-clock time from
    // the same 300s budget.
    .order("key");

  if (error) {
    return NextResponse.json(
      { status: "error", error: error.message },
      { status: 500 }
    );
  }

  const checkedAt = new Date();
  const results: Array<{
    key: string;
    ran: boolean;
    lastRunAt?: string | null;
    result?: unknown;
    error?: string;
  }> = [];

  for (const row of data ?? []) {
    // One process must never take down another on the same tick — a throw from
    // the lookup, the claim, or the runner is contained here and reported.
    try {
      const schedule = parseSchedule(
        (row.config as Record<string, unknown> | null)?.schedule
      );
      // A process with no valid schedule config defaults to hourly rather than
      // silently never running — fail toward "runs too often" (harmless, since
      // discovery + guards are idempotent) not "never runs at all".
      const effective = schedule ?? { frequency: "hourly" };
      // Read the clock per process, not once for the whole loop. Processes run
      // sequentially and maxDuration is 300s, so a slow first process could
      // otherwise have the second judged against a clock staler than
      // DUE_TOLERANCE_MS — a silently dropped run, which is the exact bug class
      // this route was rewritten to remove.
      const isDueNow = async () =>
        isRunDue(effective, new Date(), await getLastRunAt(admin, row.key));

      const lastRunAt = await getLastRunAt(admin, row.key);
      if (!isRunDue(effective, new Date(), lastRunAt)) {
        results.push({
          key: row.key,
          ran: false,
          lastRunAt: lastRunAt?.toISOString() ?? null,
        });
        continue;
      }
      const result = await runProcess(row.key, "cron", undefined, isDueNow);
      results.push({
        key: row.key,
        ran: result.status !== "skipped_not_due",
        lastRunAt: lastRunAt?.toISOString() ?? null,
        result,
      });
    } catch (err) {
      results.push({
        key: row.key,
        ran: false,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    checkedAt: checkedAt.toISOString(),
    results,
  });
}

/**
 * started_at of the most recent run that reached a terminal status, or null if
 * the process has never run. Served by the existing
 * process_runs(process_key, started_at desc) index.
 */
async function getLastRunAt(
  admin: ReturnType<typeof createAdminClient>,
  processKey: string
): Promise<Date | null> {
  const { data, error } = await admin
    .from("process_runs")
    .select("started_at")
    .eq("process_key", processKey)
    .in("status", TERMINAL_RUN_STATUSES)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLastRunAt(${processKey}): ${error.message}`);
  return data?.started_at ? new Date(data.started_at as string) : null;
}
