"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Sprout } from "lucide-react";
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

interface HarvestRow {
  id: string;
  docket_no: string | null;
  crop_name: string | null;
  variety_name: string | null;
  planting_description: string | null;
  block_name: string | null;
  state_name: string | null;
  harvested_on: string | null;
  received_on: string | null;
  farm_name: string | null;
  farm_code: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function ProductionPage() {
  const [timeRange, setTimeRange] = useState("26W");
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
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (selectedGrowerId) params.set("growerId", selectedGrowerId);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: harvests, isLoading, error } = useQuery<HarvestRow[]>({
    queryKey: ["production", queryParams],
    queryFn: () => safeFetch<HarvestRow[]>(`/api/production?${queryParams}`),
  });

  const rows = harvests ?? [];
  const distinctFarms = new Set(rows.map((r) => r.farm_code ?? r.farm_name).filter(Boolean)).size;
  const distinctCrops = new Set(rows.map((r) => r.crop_name).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <TopBar title="Production">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </TopBar>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Harvest Loads</p>
          <p className="text-2xl font-semibold text-soil">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Farms</p>
          <p className="text-2xl font-semibold text-soil">{distinctFarms}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Crops</p>
          <p className="text-2xl font-semibold text-soil">{distinctCrops}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
          <Input
            placeholder="Search docket, crop, variety, block..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 border-sand bg-warmwhite"
          />
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
        <PanelError label="Failed to load production data — try refreshing" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite py-16 text-stone">
          <Sprout className="mb-2 h-8 w-8" />
          <p className="text-sm">No harvest records found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Farm</TableHead>
                  <TableHead className="text-xs text-stone">Docket</TableHead>
                  <TableHead className="text-xs text-stone">Crop</TableHead>
                  <TableHead className="text-xs text-stone">Variety</TableHead>
                  <TableHead className="text-xs text-stone">Block</TableHead>
                  <TableHead className="text-xs text-stone">Harvested</TableHead>
                  <TableHead className="text-xs text-stone">Received</TableHead>
                  <TableHead className="text-xs text-stone">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h) => (
                  <TableRow key={h.id} className="border-sand/50">
                    <TableCell className="font-medium text-soil">
                      {h.farm_name ?? h.farm_code ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-bark">
                      {h.docket_no ?? "—"}
                    </TableCell>
                    <TableCell className="text-bark">{h.crop_name ?? "—"}</TableCell>
                    <TableCell className="text-bark">{h.variety_name ?? "—"}</TableCell>
                    <TableCell className="text-stone">{h.block_name ?? "—"}</TableCell>
                    <TableCell className="text-bark">{fmtDate(h.harvested_on)}</TableCell>
                    <TableCell className="text-bark">{fmtDate(h.received_on)}</TableCell>
                    <TableCell>
                      <HarvestStateBadge state={h.state_name} />
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

function HarvestStateBadge({ state }: { state: string | null }) {
  const s = (state ?? "").toLowerCase();
  let classes = "rounded-full px-2 py-0.5 text-xs font-medium ";
  if (s === "closed" || s === "complete") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "open") {
    classes += "bg-harvest/20 text-harvest";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{state ?? "—"}</span>;
}
