import { NextRequest, NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — List all grower_groups (with grower count, optional search)
 * POST — Create a new grower_group
 */

export async function GET(request: NextRequest) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const search = request.nextUrl.searchParams.get("search")?.trim();

  let query = admin
    .from("grower_groups")
    .select("id, name, code, abn, contact_name, contact_email, contact_phone, address, active, growers(count)")
    .order("name");

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const groups = (data ?? []).map((g: Record<string, unknown>) => ({
    ...g,
    grower_count: Array.isArray(g.growers) && g.growers.length > 0
      ? (g.growers[0] as { count: number }).count
      : 0,
    growers: undefined,
  }));

  return NextResponse.json(groups);
}

export async function POST(request: Request) {
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
  const { name, code, abn, contact_name, contact_email, contact_phone, address } = body as {
    name: string;
    code?: string;
    abn?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    address?: string;
  };

  if (!name) {
    return NextResponse.json(
      { error: "Missing required field: name" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("grower_groups")
    .insert({
      name,
      code: code || null,
      abn: abn || null,
      contact_name: contact_name || null,
      contact_email: contact_email || null,
      contact_phone: contact_phone || null,
      address: address || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
