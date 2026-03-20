import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const produceType = searchParams.get("produceType");

  const days = TIME_RANGE_DAYS[timeRange] ?? 84;
  const periodStart = new Date(Date.now() - days * 86400000);

  const supabase = createClient();

  let query = supabase
    .from("ft_consignments")
    .select("consignment_date, customer_name, weight_kg")
    .gte("consignment_date", periodStart.toISOString().split("T")[0])
    .order("consignment_date", { ascending: true });

  if (growerId) query = query.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    query = query.eq("produce_category", produceType);

  const { data: rows } = await query;

  // Group by week (Monday start) and customer
  const weekMap = new Map<
    string,
    Map<string, number>
  >();

  for (const row of rows ?? []) {
    const date = new Date(row.consignment_date);
    // Get Monday of the week
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + mondayOffset);
    const weekKey = monday.toISOString().split("T")[0];

    const customer = row.customer_name ?? "Unknown";
    const volume = Number(row.weight_kg ?? 0);

    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map());
    const customerMap = weekMap.get(weekKey)!;
    customerMap.set(customer, (customerMap.get(customer) ?? 0) + volume);
  }

  // Convert to array sorted by week
  const result = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, customerMap]) => ({
      week,
      customers: Array.from(customerMap.entries())
        .map(([name, volume]) => ({ name, volume: Math.round(volume) }))
        .sort((a, b) => b.volume - a.volume),
    }));

  return NextResponse.json(result);
}
