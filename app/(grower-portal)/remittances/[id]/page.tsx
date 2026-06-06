"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFetch } from "@/lib/portal-constants";

interface RctiDoc {
  id: string;
  filename: string;
  rcti_ref: string | null;
  payment_date: string | null;
  total_invoiced: number | null;
}

function fmtCurrency(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function RemittanceDetailPage() {
  const params = useParams<{ id: string }>();
  const downloadUrl = `/api/rcti-documents/${params.id}/download`;

  // Fetch list and find this one (single-row endpoint not strictly needed for
  // mobile detail — RLS already prevents reads outside the caller's scope).
  const { data, isLoading, error } = useQuery<RctiDoc[]>({
    queryKey: ["rcti-documents", "list-for-detail"],
    queryFn: () => safeFetch<RctiDoc[]>(`/api/rcti-documents`),
  });
  const doc = (data ?? []).find((d) => d.id === params.id) ?? null;

  return (
    <div className="space-y-4">
      <Link
        href="/remittances"
        className="inline-flex items-center gap-1.5 text-sm text-stone transition-colors hover:text-soil"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to remittances
      </Link>

      <div className="rounded-xl border border-sand bg-warmwhite p-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-10 text-blaze">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p className="text-sm">Failed to load remittance</p>
          </div>
        ) : !doc ? (
          <div className="py-10 text-center text-sm text-stone">
            Remittance not found, or you do not have access to it.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h1 className="font-mono text-base font-medium text-soil">
                {doc.rcti_ref || doc.filename}
              </h1>
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
            <iframe
              src={downloadUrl}
              title={doc.filename}
              className="h-[70vh] w-full rounded-lg border border-sand"
            />
          </div>
        )}
      </div>
    </div>
  );
}
