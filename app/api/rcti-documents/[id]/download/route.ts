import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/rcti-documents/[id]/download — returns a short-lived signed URL
 * (60s) for the requested RCTI PDF.
 *
 * Authorization: the row lookup goes through the RLS-enforced user client, so a
 * caller outside the recipient's scope resolves to "not found" — we never emit
 * a URL for content the caller can't see. The signed URL itself is minted by
 * the admin client because the storage.objects table has no per-row policies
 * (the bucket is private); reading from storage via the user client without
 * policies would fail.
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

  const admin = createAdminClient();
  const { data: signed, error: urlErr } = await admin.storage
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
