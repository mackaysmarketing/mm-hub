import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHubAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireHubAdmin();
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");

  const admin = createAdminClient();
  let q = admin
    .from("rcti_recipients")
    .select("id, grower_group_id, name, abn, netsuite_entity_id, netsuite_entity_code, active, created_at")
    .order("name", { ascending: true });
  if (groupId) q = q.eq("grower_group_id", groupId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  await requireHubAdmin();
  const body = await request.json();
  const name = (body.name as string | undefined)?.trim();
  const growerGroupId = (body.grower_group_id as string | undefined)?.trim();
  if (!name || !growerGroupId) {
    return NextResponse.json(
      { error: "name and grower_group_id are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rcti_recipients")
    .insert({
      name,
      grower_group_id: growerGroupId,
      abn: (body.abn as string | undefined)?.trim() || null,
      netsuite_entity_id: (body.netsuite_entity_id as string | undefined)?.trim() || null,
      netsuite_entity_code: (body.netsuite_entity_code as string | undefined)?.trim() || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
