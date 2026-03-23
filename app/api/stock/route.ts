import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const search = searchParams.get("search");

  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("ft_stock")
    .select(
      "id, product_name, product_code, variety, grade, quantity_on_hand, weight_kg, location, stock_date"
    )
    .order("product_name", { ascending: true });

  if (growerFilter) query = query.in("grower_id", growerFilter);
  if (search?.trim()) {
    query = query.or(
      `product_name.ilike.%${search.trim()}%,product_code.ilike.%${search.trim()}%,location.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
