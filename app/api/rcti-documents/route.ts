import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — RCTIs are PDFs, give headroom

/**
 * GET /api/rcti-documents — list RCTI PDFs visible to the caller.
 * RLS scopes by recipient_id (financial axis) via portal_can_see_recipient.
 * The recipient_id query param narrows further (e.g. for a recipient detail view).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const recipientId = searchParams.get("recipientId");
  const search = searchParams.get("search");

  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Remittances")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  let query = supabase
    .from("rcti_documents")
    .select(
      "id, recipient_id, filename, rcti_ref, payment_date, total_invoiced, file_size, uploaded_at, rcti_recipients!inner(name)"
    )
    .order("payment_date", { ascending: false, nullsFirst: false })
    .order("uploaded_at", { ascending: false })
    .limit(200);

  if (recipientId) query = query.eq("recipient_id", recipientId);
  if (search?.trim()) {
    query = query.or(
      `rcti_ref.ilike.%${search.trim()}%,filename.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let result = data ?? [];
  if (accessCtx.financialAccess["Remittances"] === false) {
    result = stripFinancials(result);
  }
  return NextResponse.json(result);
}

/**
 * POST /api/rcti-documents — hub-admin uploads a PDF and attaches it to a
 * recipient. Multipart form-data: file, recipient_id, optional rcti_ref,
 * payment_date, total_invoiced, notes.
 * Storage path: rcti/<recipient_id>/<uploaded_at>-<filename> in the documents bucket.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Hub-admin gate (uploads are a Mackays-internal action).
  const { data: hubUser } = await supabase
    .from("hub_users")
    .select("hub_role, active")
    .eq("id", user.id)
    .single();
  if (!hubUser?.active || hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const recipientId = (form.get("recipient_id") as string | null)?.trim() || null;
  const rctiRef = (form.get("rcti_ref") as string | null)?.trim() || null;
  const paymentDate = (form.get("payment_date") as string | null)?.trim() || null;
  const totalInvoicedRaw = form.get("total_invoiced") as string | null;
  const notes = (form.get("notes") as string | null)?.trim() || null;

  if (!file || !recipientId) {
    return NextResponse.json(
      { error: "Missing required fields: file, recipient_id" },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }
  const totalInvoiced = totalInvoicedRaw && totalInvoicedRaw.trim() !== ""
    ? Number(totalInvoicedRaw)
    : null;
  if (totalInvoiced !== null && !Number.isFinite(totalInvoiced)) {
    return NextResponse.json({ error: "Invalid total_invoiced" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Validate recipient exists and grab the group_id (denormalised on the row).
  const { data: recipient, error: recipientErr } = await admin
    .from("rcti_recipients")
    .select("id, grower_group_id")
    .eq("id", recipientId)
    .single();
  if (recipientErr || !recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  const storagePath = `rcti/${recipientId}/${Date.now()}-${safeName}`;

  const { error: uploadErr } = await admin.storage
    .from("documents")
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: doc, error: dbErr } = await admin
    .from("rcti_documents")
    .insert({
      recipient_id: recipientId,
      grower_group_id: recipient.grower_group_id,
      filename: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: "application/pdf",
      rcti_ref: rctiRef,
      payment_date: paymentDate,
      total_invoiced: totalInvoiced,
      notes,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (dbErr) {
    // Roll back the uploaded blob so we don't orphan storage on a DB failure.
    await admin.storage.from("documents").remove([storagePath]);
    return NextResponse.json(
      { error: `Database error: ${dbErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(doc, { status: 201 });
}
