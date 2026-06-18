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
import { PanelError } from "@/components/panel-error";
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
  order_no: string | null;
  po_no: string | null;
  pack_date: string | null;
  pickup_on: string | null;
  delivery_on: string | null;
  boxes: number | null;
  status: string | null;
  consignor: string | null;
  destination: string | null;
  carrier: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "complete"];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function DispatchPage() {
  const [timeRange, setTimeRange] = useState("26W");
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

  const { data: dispatches, isLoading, error } = useQuery<DispatchRow[]>({
    queryKey: ["dispatch", queryParams],
    queryFn: () => safeFetch<DispatchRow[]>(`/api/dispatch?${queryParams}`),
  });

  const rows = dispatches ?? [];
  const totalBoxes = rows.reduce((s, r) => s + (r.boxes ?? 0), 0);
  const pending = rows.filter((r) => r.status === "pending").length;

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
          <p className="text-xs text-stone">Total Boxes</p>
          <p className="text-2xl font-semibold text-soil">{totalBoxes.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Pending</p>
          <p className="text-2xl font-semibold text-soil">{pending}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <Input
            placeholder="Search load #, order #, PO #..."
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
      ) : error ? (
        <PanelError label="Failed to load dispatch data — try refreshing" />
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
                  <TableHead className="text-xs text-stone">Order #</TableHead>
                  <TableHead className="text-xs text-stone">Destination</TableHead>
                  <TableHead className="text-xs text-stone">Carrier</TableHead>
                  <TableHead className="text-xs text-stone">Pack</TableHead>
                  <TableHead className="text-xs text-stone">Pickup</TableHead>
                  <TableHead className="text-xs text-stone">Delivery</TableHead>
                  <TableHead className="text-xs text-stone text-right">Boxes</TableHead>
                  <TableHead className="text-xs text-stone">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id} className="border-sand/50">
                    <TableCell className="font-mono text-xs font-medium text-soil">
                      {d.load_number ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-bark">
                      {d.order_no ?? "—"}
                    </TableCell>
                    <TableCell className="text-bark">{d.destination ?? "—"}</TableCell>
                    <TableCell className="text-bark">{d.carrier ?? "—"}</TableCell>
                    <TableCell className="text-stone">{fmtDate(d.pack_date)}</TableCell>
                    <TableCell className="text-bark">{fmtDate(d.pickup_on)}</TableCell>
                    <TableCell className="text-bark">{fmtDate(d.delivery_on)}</TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {d.boxes ?? "—"}
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
  if (s === "complete") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "pending") {
    classes += "bg-harvest/20 text-harvest";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{status ?? "—"}</span>;
}
