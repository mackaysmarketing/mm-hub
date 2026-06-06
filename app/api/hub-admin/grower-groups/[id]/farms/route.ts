import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — list farms (growers rows) in this group, with recipient assignment.
 * POST — create a new farm IN this group; optionally assigned to an RCTI recipient.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("growers")
    .select(
      "id, name, code, freshtrack_code, abn, active, rcti_recipient_id, rcti_recipients(name)"
    )
    .eq("grower_group_id", groupId)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name as string | undefined)?.trim();
  const code = (body.code as string | undefined)?.trim();
  if (!name || !code) {
    return NextResponse.json(
      { error: "name and code are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Confirm the group exists (avoid silently inserting under a bad group id).
  const { data: group } = await admin
    .from("grower_groups")
    .select("id")
    .eq("id", groupId)
    .single();
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // If a recipient is supplied, ensure it belongs to this group (closes IDOR
  // at the provisioning layer too).
  const recipientId = (body.rcti_recipient_id as string | undefined)?.trim() || null;
  if (recipientId) {
    const { data: r } = await admin
      .from("rcti_recipients")
      .select("id, grower_group_id")
      .eq("id", recipientId)
      .single();
    if (!r || r.grower_group_id !== groupId) {
      return NextResponse.json(
        { error: "Recipient does not belong to this group" },
        { status: 400 }
      );
    }
  }

  const { data, error } = await admin
    .from("growers")
    .insert({
      grower_group_id: groupId,
      name,
      code,
      freshtrack_code: (body.freshtrack_code as string | undefined)?.trim() || null,
      abn: (body.abn as string | undefined)?.trim() || null,
      address: (body.address as string | undefined)?.trim() || null,
      email: (body.email as string | undefined)?.trim() || null,
      phone: (body.phone as string | undefined)?.trim() || null,
      rcti_recipient_id: recipientId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
