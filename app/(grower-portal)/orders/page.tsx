"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBar } from "@/components/top-bar";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { usePortalData } from "@/components/portal-shell";
import { safeFetch } from "@/lib/portal-constants";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface OrderRow {
  id: string;
  order_number: string;
  order_date: string | null;
  delivery_date: string | null;
  customer_name: string | null;
  product_name: string | null;
  variety: string | null;
  grade: string | null;
  quantity_ordered: number | null;
  quantity_dispatched: number | null;
  unit_price: number | null;
  total_amount: number | null;
  status: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "processing", "dispatched", "complete", "cancelled"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function fmtCurrency(v: number | null): string {
  if (v === null) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function OrdersPage() {
  const [timeRange, setTimeRange] = useState("12W");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { selectedGrowerId } = usePortalData();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  function buildParams(): string {
    const params = new URLSearchParams();
    params.set("timeRange", timeRange);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (selectedGrowerId) params.set("growerId", selectedGrowerId);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: orders, isLoading } = useQuery<OrderRow[]>({
    queryKey: ["orders", queryParams],
    queryFn: () => safeFetch<OrderRow[]>(`/api/orders?${queryParams}`),
  });

  return (
    <div className="space-y-6">
      <TopBar title="Orders">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </TopBar>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <Input
            placeholder="Search order #, customer, product..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 border-sand bg-warmwhite"
          />
        </div>
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                statusFilter === s
                  ? "bg-forest text-white"
                  : "bg-sand text-bark hover:bg-clay/20"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite py-16 text-stone">
          <ClipboardList className="mb-2 h-8 w-8" />
          <p className="text-sm">No orders found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Order #</TableHead>
                  <TableHead className="text-xs text-stone">Date</TableHead>
                  <TableHead className="text-xs text-stone">Delivery</TableHead>
                  <TableHead className="text-xs text-stone">Customer</TableHead>
                  <TableHead className="text-xs text-stone">Product</TableHead>
                  <TableHead className="text-xs text-stone">Grade</TableHead>
                  <TableHead className="text-xs text-stone text-right">Ordered</TableHead>
                  <TableHead className="text-xs text-stone text-right">Dispatched</TableHead>
                  <TableHead className="text-xs text-stone text-right">Amount</TableHead>
                  <TableHead className="text-xs text-stone">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders ?? []).map((order) => {
                  const fulfilment =
                    order.quantity_ordered && order.quantity_dispatched
                      ? Math.round(
                          (order.quantity_dispatched / order.quantity_ordered) * 100
                        )
                      : 0;

                  return (
                    <TableRow key={order.id} className="border-sand/50">
                      <TableCell className="font-mono text-xs font-medium text-soil">
                        {order.order_number ?? "—"}
                      </TableCell>
                      <TableCell className="text-bark">
                        {fmtDate(order.order_date)}
                      </TableCell>
                      <TableCell className="text-bark">
                        {fmtDate(order.delivery_date)}
                      </TableCell>
                      <TableCell className="text-bark">
                        {order.customer_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-bark">
                        {order.product_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-stone">
                        {order.grade ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-bark">
                        {order.quantity_ordered ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-bark">
                        <span className="flex items-center justify-end gap-1.5">
                          {order.quantity_dispatched ?? 0}
                          {order.quantity_ordered && order.quantity_ordered > 0 && (
                            <span
                              className={`text-[10px] ${
                                fulfilment >= 100
                                  ? "text-canopy"
                                  : fulfilment > 0
                                    ? "text-harvest"
                                    : "text-stone"
                              }`}
                            >
                              {fulfilment}%
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-bark">
                        {fmtCurrency(order.total_amount)}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={order.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
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
