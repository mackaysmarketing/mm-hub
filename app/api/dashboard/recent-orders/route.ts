import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");

  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("ft_orders")
    .select(
      "order_number, order_date, delivery_date, customer_name, product_name, quantity_ordered, quantity_dispatched, status"
    )
    .order("order_date", { ascending: false })
    .limit(10);

  if (growerFilter) query = query.in("grower_id", growerFilter);

  const { data: orders } = await query;

  return NextResponse.json(orders ?? []);
}
