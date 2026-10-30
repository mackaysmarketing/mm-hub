/**
 * POST — undo one marketer fill: set that order's marketer back to blank.
 * hub_admin only. Clears it only while it is still the marketer this tool
 * wrote; if someone has changed it since, theirs stands.
 *
 * Note for whoever uses it: while the fill is on, the next run fills a blank
 * marketer again. Pause the fill (or change its customers) first when the
 * point is to keep the order blank.
 *
 * Logged in its own small process_runs row, like the consignor Unassign, so
 * every process_actions row keeps its run_id and the audit trail is one place.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimRun, releaseRun, logAction } from "@/lib/processes/runner";
import { clearMarketer } from "@/lib/processes/consignorAssign/apply";
import { canUndoMarketerFill } from "@/lib/processes/actionGuards";
import { MARKETER_PROCESS_KEY } from "@/lib/processes/marketerFill/config";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin
    .from("process_actions")
    .select("target_id, target_ref, consignee_name, process_key, action, status, after")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Activity log entry not found" }, { status: 404 });
  }
  if (!canUndoMarketerFill(row)) {
    return NextResponse.json(
      { error: "Only a marketer this tool filled in can be undone from here." },
      { status: 409 }
    );
  }
  const filledMarketerId = (row.after as { marketer_ft_id: string }).marketer_ft_id;

  const claim = await claimRun(MARKETER_PROCESS_KEY, "manual", "apply", session.hubUser.id);
  if (!claim) {
    return NextResponse.json(
      { error: "A marketer fill run is in progress — try again in a minute." },
      { status: 409 }
    );
  }

  const logBase = {
    runId: claim.runId,
    processKey: MARKETER_PROCESS_KEY,
    targetType: "freshtrack_order",
    targetId: row.target_id as string,
    targetRef: row.target_ref as string | null,
    consigneeName: row.consignee_name as string | null,
    action: "clear_marketer" as const,
  };

  try {
    const result = await clearMarketer(row.target_id as string, filledMarketerId);

    if (result.outcome === "applied") {
      await logAction({
        ...logBase,
        status: "applied",
        before: { marketer_ft_id: filledMarketerId },
        after: { marketer_ft_id: null },
      });
      await releaseRun(claim.runId, {
        status: "success",
        candidatesSeen: 1,
        actionsProposed: 0,
        actionsApplied: 1,
        actionsSkipped: 0,
        actionsFailed: 0,
      });
      return NextResponse.json({ ok: true });
    }

    const error =
      result.outcome === "already_assigned_by_other"
        ? "The marketer on this order has been changed since — left as it is."
        : result.error;
    await logAction({ ...logBase, status: "failed", error, before: {}, after: {} });
    await releaseRun(claim.runId, {
      status: "failed",
      candidatesSeen: 1,
      actionsProposed: 0,
      actionsApplied: 0,
      actionsSkipped: 0,
      actionsFailed: 1,
      error,
    });
    return NextResponse.json({ error }, { status: result.outcome === "already_assigned_by_other" ? 409 : 500 });
  } catch (err) {
    // Never leave the run row 'running' — that would block the next 15 minutes of fills.
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await releaseRun(claim.runId, {
      status: "failed",
      candidatesSeen: 1,
      actionsProposed: 0,
      actionsApplied: 0,
      actionsSkipped: 0,
      actionsFailed: 1,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
