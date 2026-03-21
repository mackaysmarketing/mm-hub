import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

const TIME_RANGE_DAYS: Record<string, number> = {
  "4W": 28,
  "12W": 84,
  "26W": 182,
  "52W": 364,
};

const CUSTOMER_COLORS: Record<string, string> = {
  Coles: "#E50016",
  Woolworths: "#125B3C",
  ALDI: "#001E5E",
};

const DEFAULT_COLOR = "#6B6760";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const timeRange = searchParams.get("timeRange") ?? "12W";
  const produceType = searchParams.get("produceType");

  const days = TIME_RANGE_DAYS[timeRange] ?? 84;
  const periodStart = new Date(Date.now() - days * 86400000);

  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx);

  const supabase = createClient();

  let query = supabase
    .from("ft_consignments")
    .select("customer_name, weight_kg")
    .gte("consignment_date", periodStart.toISOString().split("T")[0]);

  if (growerId) query = query.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    query = query.eq("produce_category", produceType);
  if (growerFilter) query = query.in("grower_id", growerFilter);

  const { data: rows } = await query;

  const customerVolumes = new Map<string, number>();
  let totalVolume = 0;

  for (const row of rows ?? []) {
    const customer = row.customer_name ?? "Other";
    const volume = Number(row.weight_kg ?? 0);
    customerVolumes.set(customer, (customerVolumes.get(customer) ?? 0) + volume);
    totalVolume += volume;
  }

  function getCustomerColor(name: string): string {
    const lower = name.toLowerCase();
    for (const [key, color] of Object.entries(CUSTOMER_COLORS)) {
      if (lower.includes(key.toLowerCase())) return color;
    }
    return DEFAULT_COLOR;
  }

  const result = Array.from(customerVolumes.entries())
    .map(([customer, volume]) => ({
      customer,
      volume: Math.round(volume),
      percentage:
        totalVolume > 0
          ? Math.round((volume / totalVolume) * 1000) / 10
          : 0,
      color: getCustomerColor(customer),
    }))
    .sort((a, b) => b.volume - a.volume);

  return NextResponse.json(result);
}
