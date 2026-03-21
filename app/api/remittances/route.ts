import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const search = searchParams.get("search");

  // Get portal access context for financial access control
  // Note: Remittances are grower-level, no grower-specific filtering needed here
  const accessCtx = await getPortalAccessContext();

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
    query = query.or(
      `rcti_ref.ilike.%${search.trim()}%,grower_name.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let result = data ?? [];

  // Apply financial access filtering
  if (accessCtx.financialAccess["Remittances"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
