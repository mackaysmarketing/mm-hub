import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getCapabilities(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string[] {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return [];
  return (access.config as Record<string, unknown>).capabilities as string[] ?? [];
}

function getGrowerGroupId(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string | null {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return null;
  return (access.config as Record<string, unknown>).grower_group_id as string ?? null;
}

/**
 * GET — List growers belonging to the current user's grower_group
 *       Used by the grower admin user management form and by the grower switcher.
 *       For hub admin / staff with view_all_growers: returns all growers.
 *       For grower_admin: returns growers in their grower_group.
 *
 * POST — Create a grower manually (hub admin / manage_users capability only).
 */

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";

  if (!isHubAdmin && !caps.includes("view_all_growers") && !caps.includes("manage_grower_users")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Hub admin / staff see all growers
  if (isHubAdmin || caps.includes("view_all_growers")) {
    const { data, error } = await admin
      .from("growers")
      .select("id, name, code, freshtrack_code, abn, email, phone, active, address, grower_group_id")
      .order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  }

  // Grower admin sees growers in their grower_group
  const growerGroupId = getGrowerGroupId(session);
  if (!growerGroupId) {
    return NextResponse.json([]);
  }

  const { data, error } = await admin
    .from("growers")
    .select("id, name, code, region, active")
    .eq("grower_group_id", growerGroupId)
    .eq("active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("manage_users")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, code, freshtrack_code, abn, address, email, phone } = body as {
    name: string;
    code: string;
    freshtrack_code?: string;
    abn?: string;
    address?: string;
    email?: string;
    phone?: string;
  };

  if (!name || !code) {
    return NextResponse.json(
      { error: "Missing required fields: name, code" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("growers")
    .insert({
      name,
      code,
      freshtrack_code: freshtrack_code || null,
      abn: abn || null,
      address: address || null,
      email: email || null,
      phone: phone || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
