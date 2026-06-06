"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Receipt, Search, Download, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { safeFetch } from "@/lib/portal-constants";

interface RctiDoc {
  id: string;
  recipient_id: string;
  filename: string;
  rcti_ref: string | null;
  payment_date: string | null;
  total_invoiced: number | null;
  file_size: number | null;
  uploaded_at: string;
  rcti_recipients: { name: string } | null;
}

function fmtCurrency(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}
function fmtSize(b: number | null): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function RemittancesPage() {
  const { session } = useUser();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const portalAccess = session?.moduleAccess.find(
    (m) => m.module_id === "grower-portal"
  );
  const moduleRole = portalAccess?.module_role;
  const isStaffOrAdmin = moduleRole === "admin" || moduleRole === "staff";

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery<RctiDoc[]>({
    queryKey: ["rcti-documents", debouncedSearch],
    queryFn: () => {
      const p = new URLSearchParams();
      if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
      return safeFetch<RctiDoc[]>(`/api/rcti-documents?${p.toString()}`);
    },
  });

  const selected = (data ?? []).find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-soil">Remittances</h1>
        <p className="text-xs text-stone">
          Recipient-Created Tax Invoices (RCTIs) issued by Mackays. Click a row to preview or download.
        </p>
      </div>

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 220px)" }}>
        {/* Left — list */}
        <div className="w-full shrink-0 overflow-hidden rounded-xl border border-sand bg-warmwhite lg:w-96">
          <div className="border-b border-sand p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-clay" />
              <Input
                placeholder="Search RCTI ref or filename..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-blaze">
                <AlertCircle className="mb-2 h-8 w-8" />
                <p className="text-sm">Failed to load remittances</p>
                <p className="mt-1 text-xs text-stone">{String(error)}</p>
              </div>
            ) : (data ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-stone">
                <Receipt className="mb-2 h-8 w-8" />
                <p className="text-sm">No remittances available yet</p>
                <p className="mt-1 max-w-xs text-center text-xs">
                  Mackays uploads RCTI documents here when they are issued.
                </p>
              </div>
            ) : (
              <div className="space-y-0.5 p-1.5">
                {(data ?? []).map((doc) => (
                  <RctiCard
                    key={doc.id}
                    doc={doc}
                    isSelected={selectedId === doc.id}
                    showRecipient={isStaffOrAdmin}
                    onSelect={() => setSelectedId(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — detail (desktop) */}
        <div className="hidden flex-1 overflow-hidden rounded-xl border border-sand bg-warmwhite lg:flex lg:flex-col">
          {selected ? (
            <RctiPreview doc={selected} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-stone">
              <Receipt className="mb-3 h-10 w-10" />
              <p className="text-sm">Select a remittance to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RctiCard({
  doc, isSelected, showRecipient, onSelect,
}: {
  doc: RctiDoc; isSelected: boolean; showRecipient: boolean; onSelect: () => void;
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-soil">
            {doc.rcti_ref || doc.filename}
          </p>
          <p className="text-xs text-stone">{fmtDate(doc.payment_date)}</p>
          {showRecipient && doc.rcti_recipients?.name && (
            <p className="mt-0.5 truncate text-xs text-bark">
              {doc.rcti_recipients.name}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-medium text-soil">
            {fmtCurrency(doc.total_invoiced)}
          </p>
          <p className="text-xs text-stone">{fmtSize(doc.file_size)}</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:block">{card}</div>
      <Link href={`/remittances/${doc.id}`} className="block lg:hidden">
        {card}
      </Link>
    </>
  );
}

function RctiPreview({ doc }: { doc: RctiDoc }) {
  const downloadUrl = `/api/rcti-documents/${doc.id}/download`;
  return (
    <>
      <div className="flex items-center justify-between border-b border-sand p-4">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-sm font-medium text-soil">
            {doc.rcti_ref || doc.filename}
          </h2>
          <p className="text-xs text-stone">
            Paid {fmtDate(doc.payment_date)} · {fmtCurrency(doc.total_invoiced)}
          </p>
        </div>
        <a href={downloadUrl}>
          <Button size="sm" className="bg-canopy text-white hover:bg-canopy/90">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
        </a>
      </div>
      <div className="flex-1 bg-bark/5">
        <iframe
          src={downloadUrl}
          title={doc.filename}
          className="h-full w-full"
        />
      </div>
    </>
  );
}
