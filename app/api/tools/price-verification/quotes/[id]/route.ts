/**
 * DELETE — remove an uploaded quote file and everything derived from it.
 * The runs and their results cascade, which is intended: a run only ever
 * described that specific parse of that specific file.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { TOOL_KEY } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("price_quote_files").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
