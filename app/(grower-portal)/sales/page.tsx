"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { TopBar } from "@/components/top-bar";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { ProduceTypeSelector } from "@/components/produce-type-selector";
import { Skeleton } from "@/components/ui/skeleton";


const PRODUCE_TYPES = [
  { id: "Banana", label: "Banana", color: "#E8B824" },
  { id: "Avocado", label: "Avocado", color: "#1A5C34" },
  { id: "Papaya", label: "Papaya", color: "#E05528" },
  { id: "Frozen Banana", label: "Frozen", color: "#1B3A5C" },
  { id: "Passionfruit", label: "Passionfruit", color: "#8B5CF6" },
];

const CUSTOMER_COLORS: Record<string, string> = {
  Coles: "#E50016",
  Woolworths: "#125B3C",
  ALDI: "#001E5E",
};
const DEFAULT_CUSTOMER_COLOR = "#6B6760";

function getCustomerColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, color] of Object.entries(CUSTOMER_COLORS)) {
    if (lower.includes(key.toLowerCase())) return color;
  }
  return DEFAULT_CUSTOMER_COLOR;
}

// Stable colour palette for stacked bar segments
const BAR_COLORS = [
  "#E50016", "#125B3C", "#001E5E", "#D4A017",
  "#6B6760", "#9C9690", "#C8302C", "#1B3A5C",
];

function fmtCurrency(v: number): string {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWeight(v: number): string {
  return `${v.toLocaleString("en-AU")} kg`;
}

function fmtNumber(v: number): string {
  return v.toLocaleString("en-AU");
}

// --- Types ---

interface BreakdownRow {
  customer: string;
  grade: string;
  produceCategory: string;
  quantity: number;
  weightKg: number;
  unitPrice: number;
  totalAmount: number;
  pricePerKg: number;
}

interface WeekBreakdown {
  week: string;
  weekLabel: string;
  totalQuantity: number;
  totalWeightKg: number;
  totalAmount: number;
  avgPricePerKg: number;
  rows: BreakdownRow[];
}

interface PriceLandscapeWeek {
  week: string;
  avgPricePerKg: number;
  customers: { name: string; volume: number; avgPrice: number }[];
}

interface PriceLandscapeResponse {
  weeks: PriceLandscapeWeek[];
  summary: { avgPricePerKg: number; minPrice: number; maxPrice: number };
}

export default function SalesPage() {
  const [timeRange, setTimeRange] = useState("12W");
  const [produceType, setProduceType] = useState("all");
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  // Grower scoping is handled server-side via getGrowerFilter()
  function buildParams(): string {
    const params = new URLSearchParams();
    params.set("timeRange", timeRange);
    if (produceType !== "all") params.set("produceType", produceType);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: breakdown, isLoading: breakdownLoading } = useQuery<
    WeekBreakdown[]
  >({
    queryKey: ["sales-breakdown", queryParams],
    queryFn: () =>
      fetch(`/api/sales/weekly-breakdown?${queryParams}`).then((r) =>
        r.json()
      ),
    // Auto-expand first 4 weeks when data arrives
    select: (data) => {
      if (expandedWeeks.size === 0 && data.length > 0) {
        const first4 = new Set(data.slice(0, 4).map((w) => w.week));
        // Schedule state update outside render
        setTimeout(() => setExpandedWeeks(first4), 0);
      }
      return data;
    },
  });

  const { data: landscape, isLoading: landscapeLoading } =
    useQuery<PriceLandscapeResponse>({
      queryKey: ["sales-landscape", queryParams],
      queryFn: () =>
        fetch(`/api/sales/price-landscape?${queryParams}`).then((r) =>
          r.json()
        ),
    });

  function toggleWeek(week: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  }

  // Build composed chart data
  const allCustomers = new Set<string>();
  for (const week of landscape?.weeks ?? []) {
    for (const c of week.customers) allCustomers.add(c.name);
  }
  const customerList = Array.from(allCustomers);

  const chartData = (landscape?.weeks ?? []).map((week) => {
    const row: Record<string, string | number> = {
      week: new Date(week.week).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
      }),
      avgPrice: week.avgPricePerKg,
    };
    for (const c of week.customers) {
      row[c.name] = c.volume;
    }
    return row;
  });

  return (
    <div className="space-y-6">
      <TopBar title="Sales & Pricing" />

      {/* Composed Chart */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">
            Sales volume & pricing
          </h2>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>
        {landscapeLoading ? (
          <Skeleton className="h-[350px]" />
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D4CFC8" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: "#6B6760" }}
              />
              <YAxis
                yAxisId="volume"
                tick={{ fontSize: 11, fill: "#6B6760" }}
                label={{
                  value: "Volume (kg)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 11, fill: "#6B6760" },
                }}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                tick={{ fontSize: 11, fill: "#6B6760" }}
                label={{
                  value: "Avg price ($/kg)",
                  angle: 90,
                  position: "insideRight",
                  style: { fontSize: 11, fill: "#6B6760" },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#FEFDFB",
                  border: "1px solid #D4CFC8",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {customerList.map((customer, i) => (
                <Bar
                  key={customer}
                  dataKey={customer}
                  stackId="volume"
                  yAxisId="volume"
                  fill={BAR_COLORS[i % BAR_COLORS.length]}
                />
              ))}
              <Line
                dataKey="avgPrice"
                yAxisId="price"
                type="monotone"
                stroke="#172E24"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Avg $/kg"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Weekly Breakdown Table */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">Weekly breakdown</h2>
          <ProduceTypeSelector
            types={PRODUCE_TYPES}
            selected={produceType}
            onChange={setProduceType}
          />
        </div>

        {breakdownLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs text-stone">
                  <th className="pb-2 pr-4 font-medium" style={{ width: 32 }} />
                  <th className="pb-2 pr-4 font-medium">Week</th>
                  <th className="pb-2 pr-4 font-medium text-right">Qty</th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    Weight
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    Avg $/kg
                  </th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(breakdown ?? []).map((week) => {
                  const isExpanded = expandedWeeks.has(week.week);
                  return (
                    <WeekSection
                      key={week.week}
                      week={week}
                      isExpanded={isExpanded}
                      onToggle={() => toggleWeek(week.week)}
                    />
                  );
                })}
                {(breakdown ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 text-center text-sm text-stone"
                    >
                      No sales data for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Week accordion section ---

function WeekSection({
  week,
  isExpanded,
  onToggle,
}: {
  week: WeekBreakdown;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Summary row */}
      <tr
        className="cursor-pointer border-b border-sand transition-colors hover:bg-cream/50"
        onClick={onToggle}
      >
        <td className="py-3 pr-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-stone" />
          ) : (
            <ChevronRight className="h-4 w-4 text-stone" />
          )}
        </td>
        <td className="py-3 pr-4 font-medium text-soil">
          {week.weekLabel}
        </td>
        <td className="py-3 pr-4 text-right font-mono text-bark">
          {fmtNumber(week.totalQuantity)}
        </td>
        <td className="py-3 pr-4 text-right font-mono text-bark">
          {fmtWeight(week.totalWeightKg)}
        </td>
        <td className="py-3 pr-4 text-right font-mono text-bark">
          {fmtCurrency(week.avgPricePerKg)}
        </td>
        <td className="py-3 text-right font-mono font-medium text-soil">
          {fmtCurrency(week.totalAmount)}
        </td>
      </tr>

      {/* Detail rows */}
      {isExpanded &&
        week.rows.map((row, i) => (
          <tr
            key={`${week.week}-${i}`}
            className="border-b border-sand/30 bg-cream/40"
          >
            <td className="py-2" />
            <td className="py-2 pr-4 pl-6">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: getCustomerColor(row.customer) }}
                />
                <span className="text-bark">{row.customer}</span>
                <span className="text-xs text-clay">·</span>
                <span className="text-xs text-stone">{row.grade}</span>
              </div>
            </td>
            <td className="py-2 pr-4 text-right font-mono text-xs text-bark">
              {fmtNumber(row.quantity)}
            </td>
            <td className="py-2 pr-4 text-right font-mono text-xs text-bark">
              {fmtWeight(row.weightKg)}
            </td>
            <td className="py-2 pr-4 text-right font-mono text-xs text-bark">
              {fmtCurrency(row.pricePerKg)}
            </td>
            <td className="py-2 text-right font-mono text-xs text-bark">
              {fmtCurrency(row.totalAmount)}
            </td>
          </tr>
        ))}
    </>
  );
}
