import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/rcti-documents/[id]/download — short-lived signed URL (60s) for the
 * RCTI PDF. Both layers gate access:
 *   1. table RLS on rcti_documents (portal_can_see_recipient) — the row
 *      lookup returns "not found" to anyone outside the caller's recipient scope
 *   2. storage RLS on storage.objects (00007_storage_rls) — the user client
 *      can only sign URLs for paths visible under their scope
 * Defense in depth — neither layer alone is the boundary.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Remittances")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  const { data: doc, error } = await supabase
    .from("rcti_documents")
    .select("storage_path, filename")
    .eq("id", params.id)
    .single();
  if (error || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: signed, error: urlErr } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60, { download: doc.filename });
  if (urlErr || !signed) {
    return NextResponse.json(
      { error: `Failed to generate download URL: ${urlErr?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
