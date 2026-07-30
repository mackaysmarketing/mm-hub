/**
 * POST /api/processes/[key]/run — "Run now" from the Tools UI.
 *
 * hub_admin only: this can trigger a live write to FreshTrack when the
 * process's mode is 'apply'. Calls the exact same runProcess() used by the
 * ticked cron (app/api/cron/processes), bypassing only the schedule check —
 * so a manual run behaves identically to a scheduled one.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { runProcess } from "@/lib/processes/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await params;
  const result = await runProcess(key, "manual", session.hubUser.id);

  if (result.status === "disabled") {
    return NextResponse.json(
      { error: `Process '${key}' is disabled — enable it in Schedule & run first.` },
      { status: 409 }
    );
  }
  if (result.status === "skipped_locked") {
    return NextResponse.json(
      { error: "Another run of this process is already in progress." },
      { status: 409 }
    );
  }

  return NextResponse.json(result);
}
