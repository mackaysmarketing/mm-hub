import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter, hasMenuAccess } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const search = searchParams.get("search");

  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Remittances")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("remittances")
    .select(
      "id, rcti_ref, payment_date, grower_name, total_gross, total_deductions, total_invoiced, total_quantity, status, synced_at"
    )
    .order("payment_date", { ascending: false })
    .limit(50);

  if (growerFilter) query = query.in("grower_id", growerFilter);

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
