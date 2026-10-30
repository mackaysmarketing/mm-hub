/**
 * GET — the marketer fill's activity log, most recent first: every order it
 * proposed, filled, skipped or failed on, and every undo. Filterable by status.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { MARKETER_PROCESS_KEY } from "@/lib/processes/marketerFill/config";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const STATUSES = new Set(["proposed", "applied", "skipped", "failed"]);

export async function GET(request: NextRequest) {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const admin = createAdminClient();
  let query = admin
    .from("process_actions")
    .select("id, run_id, target_ref, consignee_name, action, status, skip_reason, before, after, error, applied_at, created_at")
    .eq("process_key", MARKETER_PROCESS_KEY)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (status && STATUSES.has(status)) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
