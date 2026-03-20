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
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 86400000);
  const prevPeriodStart = new Date(periodStart.getTime() - days * 86400000);

  const supabase = createClient();

  // Current period query
  let currentQ = supabase
    .from("ft_consignments")
    .select("total_amount, unit_price, quantity, weight_kg")
    .gte("consignment_date", periodStart.toISOString().split("T")[0])
    .lte("consignment_date", now.toISOString().split("T")[0]);
  if (growerId) currentQ = currentQ.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    currentQ = currentQ.eq("produce_category", produceType);

  // Previous period query
  let prevQ = supabase
    .from("ft_consignments")
    .select("total_amount, unit_price, quantity, weight_kg")
    .gte("consignment_date", prevPeriodStart.toISOString().split("T")[0])
    .lt("consignment_date", periodStart.toISOString().split("T")[0]);
  if (growerId) prevQ = prevQ.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    prevQ = prevQ.eq("produce_category", produceType);

  const [{ data: currentRows }, { data: prevRows }] = await Promise.all([
    currentQ,
    prevQ,
  ]);

  const current = currentRows ?? [];
  const prev = prevRows ?? [];

  // Gross Sales
  const currentGross = current.reduce(
    (sum, r) => sum + Number(r.total_amount ?? 0),
    0
  );
  const prevGross = prev.reduce(
    (sum, r) => sum + Number(r.total_amount ?? 0),
    0
  );

  // Avg Price (weighted by quantity)
  const currentTotalQty = current.reduce(
    (sum, r) => sum + Number(r.quantity ?? 0),
    0
  );
  const currentWeightedPrice =
    currentTotalQty > 0
      ? current.reduce(
          (sum, r) =>
            sum + Number(r.unit_price ?? 0) * Number(r.quantity ?? 0),
          0
        ) / currentTotalQty
      : 0;

  const prevTotalQty = prev.reduce(
    (sum, r) => sum + Number(r.quantity ?? 0),
    0
  );
  const prevWeightedPrice =
    prevTotalQty > 0
      ? prev.reduce(
          (sum, r) =>
            sum + Number(r.unit_price ?? 0) * Number(r.quantity ?? 0),
          0
        ) / prevTotalQty
      : 0;

  // Price Range
  const currentPrices = current
    .map((r) => Number(r.unit_price ?? 0))
    .filter((p) => p > 0);
  const currentMin =
    currentPrices.length > 0 ? Math.min(...currentPrices) : 0;
  const currentMax =
    currentPrices.length > 0 ? Math.max(...currentPrices) : 0;
  const currentRange = currentMax - currentMin;

  const prevPrices = prev
    .map((r) => Number(r.unit_price ?? 0))
    .filter((p) => p > 0);
  const prevRange =
    prevPrices.length > 0
      ? Math.max(...prevPrices) - Math.min(...prevPrices)
      : 0;

  // Total Volume (weight_kg)
  const currentVolume = current.reduce(
    (sum, r) => sum + Number(r.weight_kg ?? 0),
    0
  );
  const prevVolume = prev.reduce(
    (sum, r) => sum + Number(r.weight_kg ?? 0),
    0
  );

  function pctChange(curr: number, previous: number): number {
    if (previous === 0) return curr > 0 ? 100 : 0;
    return ((curr - previous) / previous) * 100;
  }

  return NextResponse.json({
    grossSales: {
      value: currentGross,
      change: pctChange(currentGross, prevGross),
    },
    avgPrice: {
      value: currentWeightedPrice,
      change: pctChange(currentWeightedPrice, prevWeightedPrice),
    },
    priceRange: {
      value: `$${currentMin.toFixed(2)} - $${currentMax.toFixed(2)}`,
      change: pctChange(currentRange, prevRange),
    },
    totalVolume: {
      value: currentVolume,
      change: pctChange(currentVolume, prevVolume),
    },
  });
}
