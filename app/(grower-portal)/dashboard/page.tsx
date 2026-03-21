"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  TrendingUp,
  ArrowLeftRight,
  Weight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

import { TopBar } from "@/components/top-bar";
import { StatCard } from "@/components/stat-card";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { ProduceTypeSelector } from "@/components/produce-type-selector";
import { Skeleton } from "@/components/ui/skeleton";


// Produce type definitions with brand colours
const PRODUCE_TYPES = [
  { id: "Banana", label: "Banana", color: "#E8B824" },
  { id: "Avocado", label: "Avocado", color: "#1A5C34" },
  { id: "Papaya", label: "Papaya", color: "#E05528" },
  { id: "Frozen Banana", label: "Frozen", color: "#1B3A5C" },
  { id: "Passionfruit", label: "Passionfruit", color: "#8B5CF6" },
];

// Customer colours for the stacked bar chart
const CUSTOMER_COLORS = [
  "#E50016", // Coles
  "#125B3C", // Woolworths
  "#001E5E", // ALDI
  "#D4A017", // harvest
  "#6B6760", // stone
  "#9C9690", // clay
  "#C8302C", // blaze
  "#1B3A5C", // frozen
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatWeight(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}t`;
  }
  return `${Math.round(value)} kg`;
}

interface StatsResponse {
  grossSales: { value: number; change: number };
  avgPrice: { value: number; change: number };
  priceRange: { value: string; change: number };
  totalVolume: { value: number; change: number };
}

interface VolumeWeek {
  week: string;
  customers: { name: string; volume: number }[];
}

interface CustomerMixEntry {
  customer: string;
  volume: number;
  percentage: number;
  color: string;
}

interface OrderEntry {
  order_number: string;
  order_date: string;
  delivery_date: string | null;
  customer_name: string;
  product_name: string;
  quantity_ordered: number;
  quantity_dispatched: number;
  status: string | null;
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState("12W");
  const [produceType, setProduceType] = useState("all");

  // Build query params — grower scoping is handled server-side via getGrowerFilter()
  function buildParams(): string {
    const params = new URLSearchParams();
    params.set("timeRange", timeRange);
    if (produceType !== "all") params.set("produceType", produceType);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: stats, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ["dashboard-stats", queryParams],
    queryFn: () =>
      fetch(`/api/dashboard/stats?${queryParams}`).then((r) => r.json()),
  });

  const { data: volumeData, isLoading: volumeLoading } = useQuery<
    VolumeWeek[]
  >({
    queryKey: ["dashboard-volume", queryParams],
    queryFn: () =>
      fetch(`/api/dashboard/volume?${queryParams}`).then((r) => r.json()),
  });

  const { data: customerMix, isLoading: mixLoading } = useQuery<
    CustomerMixEntry[]
  >({
    queryKey: ["dashboard-customer-mix", queryParams],
    queryFn: () =>
      fetch(`/api/dashboard/customer-mix?${queryParams}`).then((r) =>
        r.json()
      ),
  });

  const { data: recentOrders, isLoading: ordersLoading } = useQuery<
    OrderEntry[]
  >({
    queryKey: ["dashboard-recent-orders"],
    queryFn: () =>
      fetch("/api/dashboard/recent-orders").then((r) => r.json()),
  });

  // Build stacked bar chart data: flatten weeks into rows with customer columns
  const allCustomers = new Set<string>();
  for (const week of volumeData ?? []) {
    for (const c of week.customers) allCustomers.add(c.name);
  }
  const customerList = Array.from(allCustomers);

  const barChartData = (volumeData ?? []).map((week) => {
    const row: Record<string, string | number> = {
      week: new Date(week.week).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
      }),
    };
    for (const c of week.customers) {
      row[c.name] = c.volume;
    }
    return row;
  });

  return (
    <div className="space-y-6">
      <TopBar title="Dashboard">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </TopBar>

      <ProduceTypeSelector
        types={PRODUCE_TYPES}
        selected={produceType}
        onChange={setProduceType}
      />

      {/* KPI Stat Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Gross Sales"
            value={formatCurrency(stats.grossSales.value)}
            change={stats.grossSales.change}
            icon={<DollarSign className="h-5 w-5" />}
            color="text-canopy"
          />
          <StatCard
            title="Avg Price/KG"
            value={`$${stats.avgPrice.value.toFixed(2)}`}
            change={stats.avgPrice.change}
            icon={<TrendingUp className="h-5 w-5" />}
            color="text-canopy"
          />
          <StatCard
            title="Price Range"
            value={stats.priceRange.value}
            change={stats.priceRange.change}
            icon={<ArrowLeftRight className="h-5 w-5" />}
            color="text-harvest"
          />
          <StatCard
            title="Total Volume"
            value={formatWeight(stats.totalVolume.value)}
            change={stats.totalVolume.change}
            icon={<Weight className="h-5 w-5" />}
            color="text-forest"
          />
        </div>
      ) : null}

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Weekly Volume Stacked Bar Chart */}
        <div className="rounded-xl border border-sand bg-warmwhite p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-soil">
            Weekly Dispatch Volume (KG)
          </h2>
          {volumeLoading ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#D4CFC8" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 11, fill: "#6B6760" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#6B6760" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#FEFDFB",
                    border: "1px solid #D4CFC8",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                />
                {customerList.map((customer, i) => (
                  <Bar
                    key={customer}
                    dataKey={customer}
                    stackId="volume"
                    fill={CUSTOMER_COLORS[i % CUSTOMER_COLORS.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Customer Mix Donut */}
        <div className="rounded-xl border border-sand bg-warmwhite p-5">
          <h2 className="mb-4 text-sm font-semibold text-soil">
            Customer Mix
          </h2>
          {mixLoading ? (
            <Skeleton className="mx-auto h-[250px] w-[250px] rounded-full" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={customerMix}
                    dataKey="volume"
                    nameKey="customer"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {(customerMix ?? []).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#FEFDFB",
                      border: "1px solid #D4CFC8",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => [
                      `${Number(value).toLocaleString()} kg`,
                      "",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {(customerMix ?? []).slice(0, 5).map((entry) => (
                  <div
                    key={entry.customer}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-bark">{entry.customer}</span>
                    </div>
                    <span className="font-medium text-soil">
                      {entry.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h2 className="mb-4 text-sm font-semibold text-soil">Recent Orders</h2>
        {ordersLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs text-stone">
                  <th className="pb-2 pr-4 font-medium">Order #</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Delivery</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Product</th>
                  <th className="pb-2 pr-4 font-medium text-right">Ordered</th>
                  <th className="pb-2 pr-4 font-medium text-right">Dispatched</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(recentOrders ?? []).map((order, i) => (
                  <tr
                    key={i}
                    className="border-b border-sand/50 last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-mono text-xs text-soil">
                      {order.order_number}
                    </td>
                    <td className="py-2.5 pr-4 text-bark">
                      {order.order_date
                        ? new Date(order.order_date).toLocaleDateString(
                            "en-AU",
                            { day: "numeric", month: "short" }
                          )
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-bark">
                      {order.delivery_date
                        ? new Date(order.delivery_date).toLocaleDateString(
                            "en-AU",
                            { day: "numeric", month: "short" }
                          )
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-bark">
                      {order.customer_name}
                    </td>
                    <td className="py-2.5 pr-4 text-bark">
                      {order.product_name}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-bark">
                      {order.quantity_ordered}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-bark">
                      {order.quantity_dispatched}
                    </td>
                    <td className="py-2.5">
                      <OrderStatusBadge status={order.status} />
                    </td>
                  </tr>
                ))}
                {(recentOrders ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-sm text-stone"
                    >
                      No recent orders
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

function OrderStatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  let classes = "rounded-full px-2 py-0.5 text-xs font-medium ";
  if (s === "dispatched" || s === "complete" || s === "delivered") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "pending" || s === "processing") {
    classes += "bg-harvest/20 text-harvest";
  } else if (s === "cancelled") {
    classes += "bg-blaze/10 text-blaze";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{status ?? "—"}</span>;
}
