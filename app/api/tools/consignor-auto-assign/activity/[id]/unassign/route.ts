/**
 * POST — "Unassign": clear a consignor this tool set, back to null. hub_admin
 * only. This is the entire revert story under the fill-blank model — the
 * prior value is always null by construction, so there's nothing to restore
 * beyond that (design doc §5, §11).
 *
 * Wrapped in its own tiny process_runs row (via the same claim/release/
 * logAction helpers the scheduled run uses) purely so every process_actions
 * row keeps its required run_id and this shows up in the same audit trail.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimRun, releaseRun, logAction } from "@/lib/processes/runner";
import { unassignConsignor } from "@/lib/processes/consignorAssign/apply";

export const dynamic = "force-dynamic";
const PROCESS_KEY = "consignor_auto_assign";

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
  const { data: actionRow, error: fetchErr } = await admin
    .from("process_actions")
    .select("target_id, target_ref, consignee_name")
    .eq("id", id)
    .single();

  if (fetchErr || !actionRow) {
    return NextResponse.json({ error: "Activity log entry not found" }, { status: 404 });
  }

  const claim = await claimRun(PROCESS_KEY, "manual", "apply", session.hubUser.id);
  if (!claim) {
    return NextResponse.json(
      { error: "A run of this process is currently in progress — try again shortly." },
      { status: 409 }
    );
  }

  const result = await unassignConsignor(actionRow.target_id as string);

  const logBase = {
    runId: claim.runId,
    processKey: PROCESS_KEY,
    targetType: "freshtrack_order",
    targetId: actionRow.target_id as string,
    targetRef: actionRow.target_ref as string | null,
    consigneeName: actionRow.consignee_name as string | null,
    action: "unassign_consignor" as const,
  };

  if (result.outcome === "applied") {
    await logAction({
      ...logBase,
      status: "applied",
      before: { consignor_ft_id: result.before.consignorId },
      after: { consignor_ft_id: null },
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
      ? "Order is unexpectedly already unassigned"
      : result.error;
  await logAction({
    ...logBase,
    status: "failed",
    error,
    before: {},
    after: {},
  });
  await releaseRun(claim.runId, {
    status: "failed",
    candidatesSeen: 1,
    actionsProposed: 0,
    actionsApplied: 0,
    actionsSkipped: 0,
    actionsFailed: 1,
    error,
  });
  return NextResponse.json({ error }, { status: 500 });
}
