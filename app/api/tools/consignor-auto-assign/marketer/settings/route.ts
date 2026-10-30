/**
 * GET — the marketer fill's on/off, mode and config (any Tools-access user).
 * PATCH — change them (hub_admin only). Backs the "Marketer fill" tab.
 *
 * GET returns the EFFECTIVE config (stored values, defaults where missing),
 * so the page shows exactly what the runner will use. PATCH validates the
 * whole config before storing it.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MARKETER_PROCESS_KEY,
  readMarketerConfig,
  validateMarketerConfig,
} from "@/lib/processes/marketerFill/config";

export const dynamic = "force-dynamic";

const NOT_SET_UP =
  "The marketer fill isn't set up in the database yet — migration 00024 needs to be applied first.";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .select("key, name, description, enabled, mode, config, updated_at")
    .eq("key", MARKETER_PROCESS_KEY)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: NOT_SET_UP }, { status: 404 });
  return NextResponse.json({ ...data, config: readMarketerConfig(data.config) });
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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "'enabled' must be true or false" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if ("mode" in body) {
    if (body.mode !== "dry_run" && body.mode !== "apply") {
      return NextResponse.json({ error: "'mode' must be 'dry_run' or 'apply'" }, { status: 400 });
    }
    patch.mode = body.mode;
  }
  if ("config" in body) {
    const checked = validateMarketerConfig(body.config);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    patch.config = checked.config;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No recognised fields provided" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("process_definitions")
    .update(patch)
    .eq("key", MARKETER_PROCESS_KEY)
    .select("key, name, description, enabled, mode, config, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: NOT_SET_UP }, { status: 404 });
  return NextResponse.json({ ...data, config: readMarketerConfig(data.config) });
}
