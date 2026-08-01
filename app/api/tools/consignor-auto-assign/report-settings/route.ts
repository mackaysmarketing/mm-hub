/**
 * GET — recipient/schedule/enabled state plus the latest send outcome (any
 * Tools-access user). PATCH — change recipient/schedule/enabled (hub_admin
 * only). Backs the "Email reports" tab. "Send test email now" reuses the
 * existing generic POST /api/processes/[key]/run route — no dedicated send
 * endpoint here.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSchedule } from "@/lib/processes/schedule";

export const dynamic = "force-dynamic";
const PROCESS_KEY = "consignor_auto_assign_report";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [{ data: def, error: defError }, { data: latestRun }] = await Promise.all([
    admin
      .from("process_definitions")
      .select("key, name, enabled, config, updated_at")
      .eq("key", PROCESS_KEY)
      .single(),
    admin
      .from("process_runs")
      .select("id, trigger, status, started_at, completed_at, error, payload")
      .eq("process_key", PROCESS_KEY)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (defError) {
    return NextResponse.json({ error: defError.message }, { status: 500 });
  }
  return NextResponse.json({ process: def, latestRun: latestRun ?? null });
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

  if ("config" in body) {
    const config = (body.config ?? {}) as Record<string, unknown>;
    if (typeof config.recipient_email !== "string" || !EMAIL_SHAPE.test(config.recipient_email)) {
      return NextResponse.json(
        { error: "'config.recipient_email' must be a valid email address" },
        { status: 400 }
      );
    }
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
