"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Receipt, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RemittanceDetail } from "@/components/remittance-detail";
import { useUser } from "@/hooks/use-user";
import { usePortalData } from "@/components/portal-shell";
import { safeFetch } from "@/lib/portal-constants";

interface RemittanceListItem {
  id: string;
  rcti_ref: string;
  payment_date: string | null;
  grower_name: string | null;
  total_gross: number | null;
  total_deductions: number | null;
  total_invoiced: number | null;
  total_quantity: number | null;
  status: string | null;
  synced_at: string | null;
}

function fmtCurrency(v: number): string {
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function RemittancesPage() {
  const { session } = useUser();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { selectedGrowerId } = usePortalData();
  const portalAccess = session?.moduleAccess.find(
    (m) => m.module_id === "grower-portal"
  );
  const moduleRole = portalAccess?.module_role;
  const isStaffOrAdmin =
    moduleRole === "admin" || moduleRole === "staff";

  // Debounce search input
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  function buildParams(): string {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (selectedGrowerId) params.set("growerId", selectedGrowerId);
    return params.toString();
  }

  const { data: remittances, isLoading } = useQuery<RemittanceListItem[]>({
    queryKey: ["remittances-list", debouncedSearch, selectedGrowerId],
    queryFn: () =>
      safeFetch<RemittanceListItem[]>(`/api/remittances?${buildParams()}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-soil">Remittances</h1>

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Left panel — list */}
        <div className="w-full shrink-0 overflow-hidden rounded-xl border border-sand bg-warmwhite lg:w-96">
          {/* Search */}
          <div className="border-b border-sand p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-clay" />
              <Input
                placeholder="Search RCTI ref or grower..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : (remittances ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-stone">
                <Receipt className="mb-2 h-8 w-8" />
                <p className="text-sm">No remittances found</p>
              </div>
            ) : (
              <div className="space-y-0.5 p-1.5">
                {(remittances ?? []).map((rem) => (
                  <RemittanceListCard
                    key={rem.id}
                    remittance={rem}
                    isSelected={selectedId === rem.id}
                    showGrower={isStaffOrAdmin}
                    onSelect={() => setSelectedId(rem.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — detail (desktop only) */}
        <div className="hidden flex-1 overflow-y-auto rounded-xl border border-sand bg-warmwhite lg:block">
          {selectedId ? (
            <RemittanceDetail remittanceId={selectedId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-stone">
              <Receipt className="mb-3 h-10 w-10" />
              <p className="text-sm">Select a remittance to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RemittanceListCard({
  remittance,
  isSelected,
  showGrower,
  onSelect,
}: {
  remittance: RemittanceListItem;
  isSelected: boolean;
  showGrower: boolean;
  onSelect: () => void;
}) {
  const card = (
    <div
      className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
        isSelected
          ? "border-l-[3px] border-canopy bg-parchment"
          : "border-transparent hover:bg-cream/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm font-medium text-soil">
            {remittance.rcti_ref || "—"}
          </p>
          <p className="text-xs text-stone">
            {fmtDate(remittance.payment_date)}
          </p>
          {showGrower && remittance.grower_name && (
            <p className="mt-0.5 text-xs text-bark">
              {remittance.grower_name}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-medium text-soil">
            {fmtCurrency(Number(remittance.total_invoiced ?? 0))}
          </p>
          <StatusBadge status={remittance.status} />
        </div>
      </div>
    </div>
  );

  // On mobile, wrap in a Link to the detail page
  return (
    <>
      {/* Desktop: just the clickable card */}
      <div className="hidden lg:block">{card}</div>
      {/* Mobile: link to detail page */}
      <Link href={`/remittances/${remittance.id}`} className="block lg:hidden">
        {card}
      </Link>
    </>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  let classes = "mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ";
  if (s === "processed") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "pending") {
    classes += "bg-harvest/20 text-harvest";
  } else if (s === "failed") {
    classes += "bg-blaze/10 text-blaze";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{status ?? "—"}</span>;
}
