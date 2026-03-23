import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — Single grower_group with its growers
 * PATCH — Update grower_group fields
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: group, error } = await admin
    .from("grower_groups")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: growers } = await admin
    .from("growers")
    .select("id, name, code, active")
    .eq("grower_group_id", id)
    .order("name");

  return NextResponse.json({ ...group, growers: growers ?? [] });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowedFields = [
    "name",
    "code",
    "abn",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "active",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field] ?? null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  if ("name" in updates && !updates.name) {
    return NextResponse.json(
      { error: "Name cannot be empty" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("grower_groups")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
