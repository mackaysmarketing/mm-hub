"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TopBar } from "@/components/top-bar";
import { ProduceTypeSelector } from "@/components/produce-type-selector";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalData } from "@/components/portal-shell";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { PRODUCE_TYPES, safeFetch } from "@/lib/portal-constants";

interface ForecastData {
  historicalWeeks: {
    week: string;
    weightKg: number;
    amount: number;
  }[];
  summary: {
    avgWeeklyVolume: number;
    avgWeeklyRevenue: number;
    totalOutstanding: number;
    totalStockWeight: number;
    totalStockQty: number;
    weeksOfCover: number;
  };
  pendingOrders: {
    deliveryDate: string;
    productName: string;
    quantityOrdered: number;
    quantityDispatched: number;
    outstanding: number;
  }[];
}

function fmtWeight(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
  return `${Math.round(v)} kg`;
}

function fmtCurrency(v: number | null): string {
  if (v === null) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

export default function ForecastingPage() {
  const [produceType, setProduceType] = useState("all");
  const { selectedGrowerId } = usePortalData();

  function buildParams(): string {
    const params = new URLSearchParams();
    if (produceType !== "all") params.set("produceType", produceType);
    if (selectedGrowerId) params.set("growerId", selectedGrowerId);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data, isLoading } = useQuery<ForecastData>({
    queryKey: ["forecasting", queryParams],
    queryFn: () => safeFetch<ForecastData>(`/api/forecasting?${queryParams}`),
  });

  const summary = data?.summary;

  // Chart data — last 26 weeks
  const chartData = (data?.historicalWeeks ?? []).slice(-26).map((w) => ({
    week: fmtDate(w.week),
    weightKg: w.weightKg,
  }));

  return (
    <div className="space-y-6">
      <TopBar title="Forecasting" />

      <ProduceTypeSelector
        types={PRODUCE_TYPES}
        selected={produceType}
        onChange={setProduceType}
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[100px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[350px] rounded-xl" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-sand bg-warmwhite p-4">
              <p className="text-xs text-stone">Avg Weekly Volume</p>
              <p className="text-2xl font-semibold text-soil">
                {fmtWeight(summary?.avgWeeklyVolume ?? 0)}
              </p>
              <p className="mt-1 text-xs text-stone">12-week rolling avg</p>
            </div>
            <div className="rounded-xl border border-sand bg-warmwhite p-4">
              <p className="text-xs text-stone">Avg Weekly Revenue</p>
              <p className="text-2xl font-semibold text-soil">
                {fmtCurrency(summary?.avgWeeklyRevenue ?? 0)}
              </p>
              <p className="mt-1 text-xs text-stone">12-week rolling avg</p>
            </div>
            <div className="rounded-xl border border-sand bg-warmwhite p-4">
              <p className="text-xs text-stone">Stock on Hand</p>
              <p className="text-2xl font-semibold text-soil">
                {fmtWeight(summary?.totalStockWeight ?? 0)}
              </p>
              <p className="mt-1 text-xs text-stone">
                {summary?.totalStockQty.toLocaleString() ?? 0} units
              </p>
            </div>
            <div className="rounded-xl border border-sand bg-warmwhite p-4">
              <p className="text-xs text-stone">Weeks of Cover</p>
              <p
                className={`text-2xl font-semibold ${
                  (summary?.weeksOfCover ?? 0) < 2
                    ? "text-blaze"
                    : (summary?.weeksOfCover ?? 0) < 4
                      ? "text-harvest"
                      : "text-canopy"
                }`}
              >
                {summary?.weeksOfCover ?? 0}
              </p>
              <p className="mt-1 text-xs text-stone">
                {(summary?.totalOutstanding ?? 0).toLocaleString()} units outstanding
              </p>
            </div>
          </div>

          {/* Historical volume chart */}
          <div className="rounded-xl border border-sand bg-warmwhite p-5">
            <h2 className="mb-4 text-sm font-semibold text-soil">
              Weekly Volume — Last 26 Weeks
            </h2>
            {chartData.length === 0 ? (
              <p className="py-12 text-center text-sm text-stone">
                No historical data available
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#D4CFC8" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 10, fill: "#6B6760" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#6B6760" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#FEFDFB",
                      border: "1px solid #D4CFC8",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => [
                      `${Number(value).toLocaleString()} kg`,
                      "Volume",
                    ]}
                  />
                  <ReferenceLine
                    y={summary?.avgWeeklyVolume ?? 0}
                    stroke="#1A5C34"
                    strokeDasharray="5 5"
                    label={{
                      value: "Avg",
                      position: "right",
                      fill: "#1A5C34",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="weightKg" fill="#D4A017" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Pending orders */}
          {(data?.pendingOrders ?? []).length > 0 && (
            <div className="rounded-xl border border-sand bg-warmwhite p-5">
              <h2 className="mb-4 text-sm font-semibold text-soil">
                Upcoming Orders ({data?.pendingOrders.length})
              </h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-sand hover:bg-transparent">
                      <TableHead className="text-xs text-stone">
                        Delivery
                      </TableHead>
                      <TableHead className="text-xs text-stone">
                        Product
                      </TableHead>
                      <TableHead className="text-xs text-stone text-right">
                        Ordered
                      </TableHead>
                      <TableHead className="text-xs text-stone text-right">
                        Dispatched
                      </TableHead>
                      <TableHead className="text-xs text-stone text-right">
                        Outstanding
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.pendingOrders ?? []).map((o, i) => (
                      <TableRow key={i} className="border-sand/50">
                        <TableCell className="text-bark">
                          {fmtDate(o.deliveryDate)}
                        </TableCell>
                        <TableCell className="text-bark">
                          {o.productName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-bark">
                          {o.quantityOrdered}
                        </TableCell>
                        <TableCell className="text-right font-mono text-bark">
                          {o.quantityDispatched}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-soil">
                          {o.outstanding}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
