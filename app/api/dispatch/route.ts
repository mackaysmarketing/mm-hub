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
    .from("ft_dispatch")
    .select(
      "id, load_number, dispatch_date, destination, carrier, truck_rego, pallet_count, total_weight_kg, freight_cost, status"
    )
    .gte("dispatch_date", periodStart.toISOString().split("T")[0])
    .order("dispatch_date", { ascending: false })
    .limit(200);

  if (growerFilter) query = query.in("grower_id", growerFilter);
  if (status && status !== "all") query = query.eq("status", status);
  if (search?.trim()) {
    query = query.or(
      `load_number.ilike.%${search.trim()}%,destination.ilike.%${search.trim()}%,carrier.ilike.%${search.trim()}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let result = data ?? [];

  if (accessCtx.financialAccess["Dispatch"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
