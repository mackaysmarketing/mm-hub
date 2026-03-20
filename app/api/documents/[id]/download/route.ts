import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();

  // Fetch document record to get storage_path
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("storage_path, name")
    .eq("id", params.id)
    .single();

  if (docError || !doc) {
    return NextResponse.json(
      { error: "Document not found" },
      { status: 404 }
    );
  }

  // Create signed URL (60 second expiry)
  const { data: signedUrl, error: urlError } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60);

  if (urlError || !signedUrl) {
    return NextResponse.json(
      { error: `Failed to generate download URL: ${urlError?.message}` },
      { status: 500 }
    );
  }

  return NextResponse.redirect(signedUrl.signedUrl);
}
