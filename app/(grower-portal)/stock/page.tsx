"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Warehouse } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBar } from "@/components/top-bar";
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

interface StockRow {
  id: string;
  product_name: string | null;
  product_code: string | null;
  variety: string | null;
  grade: string | null;
  quantity_on_hand: number | null;
  weight_kg: number | null;
  location: string | null;
  stock_date: string | null;
}

function fmtWeight(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
  return `${Math.round(v)} kg`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

export default function StockPage() {
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
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (selectedGrowerId) params.set("growerId", selectedGrowerId);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data: stock, isLoading } = useQuery<StockRow[]>({
    queryKey: ["stock", queryParams],
    queryFn: () => safeFetch<StockRow[]>(`/api/stock?${queryParams}`),
  });

  const rows = stock ?? [];
  const totalQty = rows.reduce((s, r) => s + (r.quantity_on_hand ?? 0), 0);
  const totalWeight = rows.reduce((s, r) => s + Number(r.weight_kg ?? 0), 0);
  const locations = new Set(rows.map((r) => r.location).filter(Boolean));

  return (
    <div className="space-y-6">
      <TopBar title="Stock on Hand" />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Lines</p>
          <p className="text-2xl font-semibold text-soil">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Quantity</p>
          <p className="text-2xl font-semibold text-soil">
            {totalQty.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-sand bg-warmwhite p-4">
          <p className="text-xs text-stone">Total Weight</p>
          <p className="text-2xl font-semibold text-soil">{fmtWeight(totalWeight)}</p>
          <p className="mt-1 text-xs text-stone">
            {locations.size} location{locations.size !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
        <Input
          placeholder="Search product, code, or location..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9 border-sand bg-warmwhite"
        />
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
          <Warehouse className="mb-2 h-8 w-8" />
          <p className="text-sm">No stock records found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Product</TableHead>
                  <TableHead className="text-xs text-stone">Code</TableHead>
                  <TableHead className="text-xs text-stone">Variety</TableHead>
                  <TableHead className="text-xs text-stone">Grade</TableHead>
                  <TableHead className="text-xs text-stone text-right">Qty</TableHead>
                  <TableHead className="text-xs text-stone text-right">Weight</TableHead>
                  <TableHead className="text-xs text-stone">Location</TableHead>
                  <TableHead className="text-xs text-stone">As at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} className="border-sand/50">
                    <TableCell className="font-medium text-soil">
                      {s.product_name ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-bark">
                      {s.product_code ?? "—"}
                    </TableCell>
                    <TableCell className="text-bark">
                      {s.variety ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-stone">
                      {s.grade ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {s.quantity_on_hand?.toLocaleString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-bark">
                      {fmtWeight(s.weight_kg ? Number(s.weight_kg) : null)}
                    </TableCell>
                    <TableCell className="text-bark">
                      {s.location ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-stone">
                      {fmtDate(s.stock_date)}
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
