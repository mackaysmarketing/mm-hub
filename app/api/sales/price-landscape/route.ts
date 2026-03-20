import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TIME_RANGE_DAYS: Record<string, number> = {
  "4W": 28,
  "12W": 84,
  "26W": 182,
  "52W": 364,
};

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

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
    .select(
      "consignment_date, customer_name, weight_kg, total_amount, unit_price"
    )
    .gte("consignment_date", periodStart.toISOString().split("T")[0])
    .order("consignment_date", { ascending: true });

  if (growerId) query = query.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    query = query.eq("produce_category", produceType);

  const { data: rows } = await query;

  // Group by week → customer (volume + weighted price)
  const weekMap = new Map<
    string,
    Map<string, { volume: number; totalAmount: number }>
  >();

  let globalTotalAmount = 0;
  let globalTotalWeight = 0;
  let globalMinPrice = Infinity;
  let globalMaxPrice = -Infinity;

  for (const row of rows ?? []) {
    const date = new Date(row.consignment_date);
    const monday = getMonday(date);
    const weekKey = monday.toISOString().split("T")[0];

    const customer = row.customer_name ?? "Unknown";
    const wkg = Number(row.weight_kg ?? 0);
    const tAmount = Number(row.total_amount ?? 0);
    const uPrice = Number(row.unit_price ?? 0);

    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map());
    const customerMap = weekMap.get(weekKey)!;

    const existing = customerMap.get(customer) ?? {
      volume: 0,
      totalAmount: 0,
    };
    existing.volume += wkg;
    existing.totalAmount += tAmount;
    customerMap.set(customer, existing);

    globalTotalAmount += tAmount;
    globalTotalWeight += wkg;
    if (uPrice > 0) {
      globalMinPrice = Math.min(globalMinPrice, uPrice);
      globalMaxPrice = Math.max(globalMaxPrice, uPrice);
    }
  }

  // Build weekly data with per-customer volume and overall avgPrice
  const weeks = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, customerMap]) => {
      let weekTotalAmount = 0;
      let weekTotalWeight = 0;
      const customers = Array.from(customerMap.entries()).map(
        ([name, data]) => {
          weekTotalAmount += data.totalAmount;
          weekTotalWeight += data.volume;
          return {
            name,
            volume: Math.round(data.volume),
            avgPrice:
              data.volume > 0
                ? Math.round((data.totalAmount / data.volume) * 100) / 100
                : 0,
          };
        }
      );

      return {
        week,
        avgPricePerKg:
          weekTotalWeight > 0
            ? Math.round((weekTotalAmount / weekTotalWeight) * 100) / 100
            : 0,
        customers: customers.sort((a, b) => b.volume - a.volume),
      };
    });

  return NextResponse.json({
    weeks,
    summary: {
      avgPricePerKg:
        globalTotalWeight > 0
          ? Math.round((globalTotalAmount / globalTotalWeight) * 100) / 100
          : 0,
      minPrice: globalMinPrice === Infinity ? 0 : globalMinPrice,
      maxPrice: globalMaxPrice === -Infinity ? 0 : globalMaxPrice,
    },
  });
}
