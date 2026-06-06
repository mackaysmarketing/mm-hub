import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/hub-admin/rcti-recipients/[id] — update name/abn/netsuite ids/active.
 * DELETE /api/hub-admin/rcti-recipients/[id] — refuses if any farms or RCTI
 * documents still reference this recipient (force-removal would orphan rows).
 */

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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

  const allowed = ["name", "abn", "netsuite_entity_id", "netsuite_entity_code", "active"] as const;
  const updates: Record<string, unknown> = {};
  for (const f of allowed) {
    if (f in body) {
      const v = body[f];
      updates[f] = typeof v === "string" && v.trim() === "" ? null : v;
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if ("name" in updates && !updates.name) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rcti_recipients")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Refuse if there are dependencies — protect referential integrity in a way
  // the user can act on rather than silently failing with a FK error.
  const [{ count: farmsCount }, { count: docsCount }] = await Promise.all([
    admin
      .from("growers")
      .select("id", { count: "exact", head: true })
      .eq("rcti_recipient_id", params.id),
    admin
      .from("rcti_documents")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", params.id),
  ]);
  if ((farmsCount ?? 0) > 0 || (docsCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Recipient is referenced by ${farmsCount ?? 0} farm(s) and ${docsCount ?? 0} RCTI document(s). Unassign or delete them first, or deactivate the recipient instead.`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin
    .from("rcti_recipients")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
