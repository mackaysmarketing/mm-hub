import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  const supabase = createClient();

  let query = supabase
    .from("documents")
    .select("id, name, category, file_size, mime_type, uploaded_at, uploaded_by")
    .order("uploaded_at", { ascending: false });

  if (growerId) query = query.eq("grower_id", growerId);
  if (category && category !== "all") query = query.eq("category", category);
  if (search && search.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
