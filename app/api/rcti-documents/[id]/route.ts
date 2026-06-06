import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/rcti-documents/[id] — hub-admin updates an RCTI document's metadata
 * (rcti_ref, payment_date, total_invoiced, notes). The blob itself is immutable
 * — re-upload (DELETE then POST) to replace it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: hubUser } = await supabase
    .from("hub_users")
    .select("hub_role, active")
    .eq("id", user.id)
    .single();
  if (!hubUser?.active || hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed = ["rcti_ref", "payment_date", "notes"] as const;
  const updates: Record<string, unknown> = {};
  for (const f of allowed) {
    if (f in body) {
      const v = body[f];
      updates[f] = typeof v === "string" && v.trim() === "" ? null : (v ?? null);
    }
  }
  if ("total_invoiced" in body) {
    const v = body.total_invoiced;
    if (v === null || v === undefined || v === "") {
      updates.total_invoiced = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Invalid total_invoiced" }, { status: 400 });
      }
      updates.total_invoiced = n;
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rcti_documents")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * DELETE /api/rcti-documents/[id] — hub-admin removes the row + the storage blob.
 * Storage cleanup is best-effort: a missing object doesn't fail the delete.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: hubUser } = await supabase
    .from("hub_users")
    .select("hub_role, active")
    .eq("id", user.id)
    .single();
  if (!hubUser?.active || hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("rcti_documents")
    .select("storage_path")
    .eq("id", params.id)
    .single();
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove storage object first (best-effort), then the DB row. If the row
  // delete fails, the cron + next list-refresh still surface a stale blob —
  // a periodic cleanup job is the proper backstop (parked for later).
  await admin.storage.from("documents").remove([doc.storage_path]);

  const { error } = await admin
    .from("rcti_documents")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
