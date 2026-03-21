import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — List all grower_groups
 * POST — Create a new grower_group
 */

export async function GET() {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("grower_groups")
    .select("id, name, code, abn, contact_name, contact_email, contact_phone, address, active")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
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
