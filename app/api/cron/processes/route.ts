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
 * common path is one Supabase select and an early return: work only happens on
 * the ticks where a process is actually due.
 *
 * "Run now" (app/api/processes/[key]/run) calls the exact same runProcess()
 * function directly, bypassing the schedule check, so a manual run and a
 * scheduled run can never diverge in behaviour.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runProcess } from "@/lib/processes/registry";
import { parseSchedule, isRunDue } from "@/lib/processes/schedule";

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
    .eq("enabled", true);

  if (error) {
    return NextResponse.json(
      { status: "error", error: error.message },
      { status: 500 }
    );
  }

  const now = new Date();
  const results: Array<{ key: string; ran: boolean; result?: unknown }> = [];

  for (const row of data ?? []) {
    const schedule = parseSchedule(
      (row.config as Record<string, unknown> | null)?.schedule
    );
    // A process with no valid schedule config defaults to hourly rather than
    // silently never running — fail toward "runs too often" (harmless, since
    // discovery + guards are idempotent) not "never runs at all".
    const due = isRunDue(schedule ?? { frequency: "hourly" }, now);
    if (!due) {
      results.push({ key: row.key, ran: false });
      continue;
    }
    const result = await runProcess(row.key, "cron");
    results.push({ key: row.key, ran: true, result });
  }

  return NextResponse.json({ status: "ok", checkedAt: now.toISOString(), results });
}
