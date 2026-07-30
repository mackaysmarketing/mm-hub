/**
 * GET — activity log: every order the tool has proposed or actually
 * assigned, most recent first. Filterable by status and mode.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const PROCESS_KEY = "consignor_auto_assign";
const PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get("status"); // proposed|applied|skipped|failed
  const mode = request.nextUrl.searchParams.get("mode"); // dry_run|apply — filters via the parent run

  const admin = createAdminClient();

  let runIdsForMode: string[] | null = null;
  if (mode === "dry_run" || mode === "apply") {
    const { data: runs } = await admin
      .from("process_runs")
      .select("id")
      .eq("process_key", PROCESS_KEY)
      .eq("mode", mode);
    runIdsForMode = (runs ?? []).map((r) => r.id as string);
    if (runIdsForMode.length === 0) {
      return NextResponse.json([]);
    }
  }

  let query = admin
    .from("process_actions")
    .select(
      "id, run_id, target_ref, consignee_name, action, status, skip_reason, rule_id, before, after, error, applied_at, created_at"
    )
    .eq("process_key", PROCESS_KEY)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (status) query = query.eq("status", status);
  if (runIdsForMode) query = query.in("run_id", runIdsForMode);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
