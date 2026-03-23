"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Truck } from "lucide-react";
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

interface DispatchRow {
  id: string;
  load_number: string | null;
  dispatch_date: string | null;
  destination: string | null;
  carrier: string | null;
  truck_rego: string | null;
  pallet_count: number | null;
  total_weight_kg: number | null;
  freight_cost: number | null;
  status: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "in-transit", "delivered"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function fmtWeight(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
  return `${Math.round(v)} kg`;
}

function fmtCurrency(v: number | null): string {
  if (v === null) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function DispatchPage() {
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

  const { data: dispatches, isLoading } = useQuery<DispatchRow[]>({
    queryKey: ["dispatch", queryParams],
    queryFn: () => safeFetch<DispatchRow[]>(`/api/dispatch?${queryParams}`),
  });

  // Summary stats
  const rows = dispatches ?? [];
  const totalPallets = rows.reduce((s, r) => s + (r.pallet_count ?? 0), 0);
  const totalWeight = rows.reduce((s, r) => s + Number(r.total_weight_kg ?? 0), 0);
  const inTransit = rows.filter(
    (r) => r.status?.toLowerCase() === "in-transit"
  ).length;

  return (
    <div className="space-y-6">
      <TopBar title="Dispatch Tracking">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </TopBar>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Loads</p>
          <p className="text-2xl font-semibold text-soil">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Pallets</p>
          <p className="text-2xl font-semibold text-soil">{totalPallets.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Weight</p>
          <p className="text-2xl font-semibold text-soil">{fmtWeight(totalWeight)}</p>
          {inTransit > 0 && (
            <p className="mt-1 text-xs text-harvest">{inTransit} in transit</p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <Input
            placeholder="Search load #, destination, carrier..."
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
              {s === "all"
                ? "All"
                : s
                    .split("-")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
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
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite py-16 text-stone">
          <Truck className="mb-2 h-8 w-8" />
          <p className="text-sm">No dispatch records found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Load #</TableHead>
                  <TableHead className="text-xs text-stone">Date</TableHead>
                  <TableHead className="text-xs text-stone">Destination</TableHead>
                  <TableHead className="text-xs text-stone">Carrier</TableHead>
                  <TableHead className="text-xs text-stone">Truck</TableHead>
                  <TableHead className="text-xs text-stone text-right">Pallets</TableHead>
                  <TableHead className="text-xs text-stone text-right">Weight</TableHead>
                  <TableHead className="text-xs text-stone text-right">Freight</TableHead>
                  <TableHead className="text-xs text-stone">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id} className="border-sand/50">
                    <TableCell className="font-mono text-xs font-medium text-soil">
                      {d.load_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-bark">
                      {fmtDate(d.dispatch_date)}
                    </TableCell>
                    <TableCell className="text-bark">
                      {d.destination ?? "—"}
                    </TableCell>
                    <TableCell className="text-bark">
                      {d.carrier ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-stone">
                      {d.truck_rego ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {d.pallet_count ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {fmtWeight(d.total_weight_kg)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {fmtCurrency(d.freight_cost)}
                    </TableCell>
                    <TableCell>
                      <DispatchStatusBadge status={d.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function DispatchStatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  let classes = "rounded-full px-2 py-0.5 text-xs font-medium ";
  if (s === "delivered") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "in-transit") {
    classes += "bg-harvest/20 text-harvest";
  } else if (s === "pending") {
    classes += "bg-sand text-bark";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{status ?? "—"}</span>;
}
