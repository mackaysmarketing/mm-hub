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
    .from("farms")
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
    .from("farms")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * DELETE /api/hub-admin/farms/[id] — refuses if synced fact rows (ft_*, qa_*,
 * documents) reference the farm. Deactivating is the right move for an
 * established farm; delete is for an accidental row that was never used.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const factTables = [
    "ft_consignments",
    "ft_orders",
    "ft_pallets",
    "ft_dispatch",
    "ft_charges",
    "ft_stock",
    "qa_assessments",
    "qa_audits",
    "documents",
  ] as const;

  const counts = await Promise.all(
    factTables.map((t) =>
      admin.from(t).select("id", { count: "exact", head: true }).eq("grower_id", id)
    )
  );
  const dependents = counts.reduce(
    (s, r) => s + (r.count ?? 0),
    0
  );
  if (dependents > 0) {
    return NextResponse.json(
      {
        error: `Farm has ${dependents} associated record(s) (consignments / dispatch / QA / documents). Deactivate the farm instead.`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("farms").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
