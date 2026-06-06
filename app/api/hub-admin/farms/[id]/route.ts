import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/hub-admin/farms/[id] — update a farm (name/code/freshtrack_code/
 * abn/active/rcti_recipient_id). Validates the recipient assignment stays
 * inside the farm's grower_group so a hub admin can't accidentally bind a farm
 * in Group A to a recipient in Group B.
 */
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

  const admin = createAdminClient();

  const { data: farm } = await admin
    .from("growers")
    .select("id, grower_group_id")
    .eq("id", id)
    .single();
  if (!farm) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const allowed = ["name", "code", "freshtrack_code", "abn", "active"] as const;
  const updates: Record<string, unknown> = {};
  for (const f of allowed) {
    if (f in body) updates[f] = body[f] ?? null;
  }

  // Recipient assignment requires cross-axis validation.
  if ("rcti_recipient_id" in body) {
    const recipientId = (body.rcti_recipient_id as string | null) || null;
    if (recipientId) {
      const { data: r } = await admin
        .from("rcti_recipients")
        .select("id, grower_group_id")
        .eq("id", recipientId)
        .single();
      if (!r || r.grower_group_id !== farm.grower_group_id) {
        return NextResponse.json(
          { error: "Recipient does not belong to this farm's group" },
          { status: 400 }
        );
      }
    }
    updates.rcti_recipient_id = recipientId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if ("name" in updates && !updates.name) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("growers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
