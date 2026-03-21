import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getFarmFilter } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

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

function formatWeekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

interface DetailRow {
  customer: string;
  grade: string;
  produceCategory: string;
  quantity: number;
  weightKg: number;
  unitPrice: number;
  totalAmount: number;
  pricePerKg: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const timeRange = searchParams.get("timeRange") ?? "12W";
  const produceType = searchParams.get("produceType");
  const farmId = searchParams.get("farmId");

  const days = TIME_RANGE_DAYS[timeRange] ?? 84;
  const periodStart = new Date(Date.now() - days * 86400000);

  const accessCtx = await getPortalAccessContext();
  const farmFilter = getFarmFilter(accessCtx, farmId);

  const supabase = createClient();

  let query = supabase
    .from("ft_consignments")
    .select(
      "consignment_date, customer_name, grade, produce_category, quantity, weight_kg, unit_price, total_amount"
    )
    .gte("consignment_date", periodStart.toISOString().split("T")[0])
    .order("consignment_date", { ascending: false });

  if (growerId) query = query.eq("grower_id", growerId);
  if (produceType && produceType !== "all")
    query = query.eq("produce_category", produceType);
  if (farmFilter) query = query.in("farm_id", farmFilter);

  const { data: rows } = await query;

  // Group by week → detail rows
  const weekMap = new Map<
    string,
    {
      monday: Date;
      rows: DetailRow[];
      totalQuantity: number;
      totalWeightKg: number;
      totalAmount: number;
    }
  >();

  for (const row of rows ?? []) {
    const date = new Date(row.consignment_date);
    const monday = getMonday(date);
    const weekKey = monday.toISOString().split("T")[0];

    const qty = Number(row.quantity ?? 0);
    const wkg = Number(row.weight_kg ?? 0);
    const uPrice = Number(row.unit_price ?? 0);
    const tAmount = Number(row.total_amount ?? 0);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        monday,
        rows: [],
        totalQuantity: 0,
        totalWeightKg: 0,
        totalAmount: 0,
      });
    }

    const week = weekMap.get(weekKey)!;

    const customer = row.customer_name ?? "Unknown";
    const grade = row.grade ?? "—";
    const category = row.produce_category ?? "Other";

    const existing = week.rows.find(
      (r) =>
        r.customer === customer &&
        r.grade === grade &&
        r.produceCategory === category
    );

    if (existing) {
      existing.quantity += qty;
      existing.weightKg += wkg;
      existing.totalAmount += tAmount;
      existing.unitPrice =
        existing.quantity > 0 ? existing.totalAmount / existing.quantity : 0;
      existing.pricePerKg =
        existing.weightKg > 0 ? existing.totalAmount / existing.weightKg : 0;
    } else {
      week.rows.push({
        customer,
        grade,
        produceCategory: category,
        quantity: qty,
        weightKg: wkg,
        unitPrice: uPrice,
        totalAmount: tAmount,
        pricePerKg: wkg > 0 ? tAmount / wkg : 0,
      });
    }

    week.totalQuantity += qty;
    week.totalWeightKg += wkg;
    week.totalAmount += tAmount;
  }

  let result = Array.from(weekMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekKey, week]) => ({
      week: weekKey,
      weekLabel: formatWeekLabel(week.monday),
      totalQuantity: week.totalQuantity,
      totalWeightKg: Math.round(week.totalWeightKg),
      totalAmount: Math.round(week.totalAmount * 100) / 100,
      avgPricePerKg:
        week.totalWeightKg > 0
          ? Math.round((week.totalAmount / week.totalWeightKg) * 100) / 100
          : 0,
      rows: week.rows
        .map((r) => ({
          ...r,
          weightKg: Math.round(r.weightKg),
          unitPrice: Math.round(r.unitPrice * 100) / 100,
          totalAmount: Math.round(r.totalAmount * 100) / 100,
          pricePerKg: Math.round(r.pricePerKg * 100) / 100,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount),
    }));

  // Apply financial access filtering
  if (accessCtx.financialAccess["Sales & Pricing"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
