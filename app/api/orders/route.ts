import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

const TIME_RANGE_DAYS: Record<string, number> = {
  "4W": 28,
  "12W": 84,
  "26W": 182,
  "52W": 364,
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const timeRange = searchParams.get("timeRange") ?? "12W";
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const days = TIME_RANGE_DAYS[timeRange] ?? 84;
  const periodStart = new Date(Date.now() - days * 86400000);

  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("ft_orders")
    .select(
      "id, order_number, order_date, delivery_date, customer_name, product_name, variety, grade, quantity_ordered, quantity_dispatched, unit_price, total_amount, status"
    )
    .gte("order_date", periodStart.toISOString().split("T")[0])
    .order("order_date", { ascending: false })
    .limit(200);

  if (growerFilter) query = query.in("grower_id", growerFilter);
  if (status && status !== "all") query = query.eq("status", status);
  if (search?.trim()) {
    query = query.or(
      `order_number.ilike.%${search.trim()}%,customer_name.ilike.%${search.trim()}%,product_name.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let result = data ?? [];

  if (accessCtx.financialAccess["Orders"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
