import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const produceType = searchParams.get("produceType");

  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();
  const now = new Date();
  const weeksBack52 = new Date(now.getTime() - 364 * 86400000);

  // Historical weekly consignment data (52 weeks)
  let histQ = supabase
    .from("ft_consignments")
    .select("consignment_date, weight_kg, total_amount")
    .gte("consignment_date", weeksBack52.toISOString().split("T")[0])
    .order("consignment_date", { ascending: true });

  if (growerFilter) histQ = histQ.in("grower_id", growerFilter);
  if (produceType && produceType !== "all")
    histQ = histQ.eq("produce_category", produceType);

  // Pending orders (future demand signal)
  let ordersQ = supabase
    .from("ft_orders")
    .select("delivery_date, quantity_ordered, quantity_dispatched, product_name")
    .gte("delivery_date", now.toISOString().split("T")[0])
    .order("delivery_date", { ascending: true });

  if (growerFilter) ordersQ = ordersQ.in("grower_id", growerFilter);

  // Current stock
  let stockQ = supabase
    .from("ft_stock")
    .select("product_name, quantity_on_hand, weight_kg");

  if (growerFilter) stockQ = stockQ.in("grower_id", growerFilter);

  const [histResult, ordersResult, stockResult] = await Promise.all([
    histQ,
    ordersQ,
    stockQ,
  ]);

  // Build weekly historical volumes
  function getMonday(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    return d.toISOString().split("T")[0];
  }

  const weeklyVolume = new Map<string, { weightKg: number; amount: number }>();
  for (const row of histResult.data ?? []) {
    const weekKey = getMonday(new Date(row.consignment_date));
    const existing = weeklyVolume.get(weekKey) ?? { weightKg: 0, amount: 0 };
    existing.weightKg += Number(row.weight_kg ?? 0);
    existing.amount += Number(row.total_amount ?? 0);
    weeklyVolume.set(weekKey, existing);
  }

  const historicalWeeks = Array.from(weeklyVolume.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({
      week,
      weightKg: Math.round(data.weightKg),
      amount: Math.round(data.amount * 100) / 100,
    }));

  // Calculate rolling averages
  const recentWeeks = historicalWeeks.slice(-12);
  const avgWeeklyVolume =
    recentWeeks.length > 0
      ? Math.round(
          recentWeeks.reduce((s, w) => s + w.weightKg, 0) / recentWeeks.length
        )
      : 0;
  const avgWeeklyRevenue =
    recentWeeks.length > 0
      ? Math.round(
          (recentWeeks.reduce((s, w) => s + w.amount, 0) / recentWeeks.length) *
            100
        ) / 100
      : 0;

  // Pending orders summary
  const pendingOrders = (ordersResult.data ?? []).map((o) => ({
    deliveryDate: o.delivery_date,
    productName: o.product_name,
    quantityOrdered: o.quantity_ordered,
    quantityDispatched: o.quantity_dispatched,
    outstanding: (o.quantity_ordered ?? 0) - (o.quantity_dispatched ?? 0),
  }));

  const totalOutstanding = pendingOrders.reduce(
    (s, o) => s + o.outstanding,
    0
  );

  // Stock summary
  const totalStockWeight = (stockResult.data ?? []).reduce(
    (s, r) => s + Number(r.weight_kg ?? 0),
    0
  );
  const totalStockQty = (stockResult.data ?? []).reduce(
    (s, r) => s + Number(r.quantity_on_hand ?? 0),
    0
  );

  // Weeks of stock cover
  const weeksOfCover =
    avgWeeklyVolume > 0
      ? Math.round((totalStockWeight / avgWeeklyVolume) * 10) / 10
      : 0;

  let result = {
    historicalWeeks,
    summary: {
      avgWeeklyVolume,
      avgWeeklyRevenue,
      totalOutstanding,
      totalStockWeight: Math.round(totalStockWeight),
      totalStockQty,
      weeksOfCover,
    },
    pendingOrders: pendingOrders.slice(0, 20),
  };

  if (accessCtx.financialAccess["Forecasting"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
