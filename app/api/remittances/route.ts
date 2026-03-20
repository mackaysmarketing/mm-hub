import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const search = searchParams.get("search");

  const supabase = createClient();

  let query = supabase
    .from("remittances")
    .select(
      "id, rcti_ref, payment_date, grower_name, total_gross, total_deductions, total_invoiced, total_quantity, status, synced_at"
    )
    .order("payment_date", { ascending: false })
    .limit(50);

  if (growerId) query = query.eq("grower_id", growerId);

  if (search && search.trim()) {
    // Filter by rcti_ref or grower_name (case-insensitive)
    query = query.or(
      `rcti_ref.ilike.%${search.trim()}%,grower_name.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
