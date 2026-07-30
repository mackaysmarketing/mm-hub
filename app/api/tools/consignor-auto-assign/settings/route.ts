/**
 * GET — mode/schedule/enabled state (any Tools-access user).
 * PATCH — change them (hub_admin only). Backs the "Schedule & run" tab.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSchedule } from "@/lib/processes/schedule";

export const dynamic = "force-dynamic";
const PROCESS_KEY = "consignor_auto_assign";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .select("key, name, description, enabled, mode, config, updated_at")
    .eq("key", PROCESS_KEY)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "'enabled' must be a boolean" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }

  if ("mode" in body) {
    if (body.mode !== "dry_run" && body.mode !== "apply") {
      return NextResponse.json(
        { error: "'mode' must be 'dry_run' or 'apply'" },
        { status: 400 }
      );
    }
    patch.mode = body.mode;
  }

  if ("config" in body) {
    const config = (body.config ?? {}) as Record<string, unknown>;
    if (config.schedule && !parseSchedule(config.schedule)) {
      return NextResponse.json({ error: "Invalid schedule shape" }, { status: 400 });
    }
    patch.config = config;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No recognised fields provided" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .update(patch)
    .eq("key", PROCESS_KEY)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
