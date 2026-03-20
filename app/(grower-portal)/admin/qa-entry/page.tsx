"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ClipboardPlus, CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface GrowerQARow {
  grower_id: string;
  grower_name: string;
  grower_code: string;
  latest_score: number | null;
  latest_status: string | null;
  last_assessed: string | null;
  next_audit_date: string | null;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sand/60 px-2 py-0.5 text-xs font-medium text-stone">
        <ShieldCheck className="h-3 w-3" />
        No assessment
      </span>
    );
  }
  const map: Record<string, { icon: React.ReactNode; label: string; classes: string }> = {
    compliant: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Compliant",
      classes: "bg-canopy/10 text-canopy",
    },
    at_risk: {
      icon: <AlertTriangle className="h-3 w-3" />,
      label: "At Risk",
      classes: "bg-harvest/15 text-harvest",
    },
    non_compliant: {
      icon: <XCircle className="h-3 w-3" />,
      label: "Non-Compliant",
      classes: "bg-blaze/10 text-blaze",
    },
  };
  const s = map[status] ?? map.compliant;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.classes}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function scoreColor(score: number | null, status: string | null): string {
  if (score === null) return "text-stone";
  if (status === "compliant") return "text-canopy";
  if (status === "at_risk") return "text-harvest";
  if (status === "non_compliant") return "text-blaze";
  return "text-soil";
}

export default function QAEntryPage() {
  const router = useRouter();

  const { data, isLoading } = useQuery<GrowerQARow[]>({
    queryKey: ["admin-qa-growers"],
    queryFn: () =>
      fetch("/api/grower-portal/admin/qa").then((r) => r.json()),
  });

  const growers = data ?? [];

  return (
    <div className="space-y-6">
      <TopBar title="QA Assessments" />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Grower</TableHead>
                <TableHead className="text-xs text-stone">QA Status</TableHead>
                <TableHead className="text-xs text-stone">Score</TableHead>
                <TableHead className="text-xs text-stone">Last Assessed</TableHead>
                <TableHead className="text-xs text-stone">Next Audit</TableHead>
                <TableHead className="text-xs text-stone w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {growers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-stone">
                    No active growers
                  </TableCell>
                </TableRow>
              ) : (
                growers.map((g) => (
                  <TableRow key={g.grower_id} className="border-sand/50">
                    <TableCell>
                      <div>
                        <span className="font-medium text-soil">{g.grower_name}</span>
                        <span className="ml-2 font-mono text-xs text-stone">{g.grower_code}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={g.latest_status} />
                    </TableCell>
                    <TableCell>
                      <span className={`font-mono text-sm font-semibold ${scoreColor(g.latest_score, g.latest_status)}`}>
                        {g.latest_score !== null ? g.latest_score.toFixed(1) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-bark">
                      {g.last_assessed
                        ? new Date(g.last_assessed).toLocaleDateString("en-AU", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-bark">
                      {g.next_audit_date
                        ? new Date(g.next_audit_date).toLocaleDateString("en-AU", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-sand text-bark text-xs"
                        onClick={() =>
                          router.push(`/admin/qa-entry/${g.grower_id}`)
                        }
                      >
                        <ClipboardPlus className="h-3.5 w-3.5" />
                        New Assessment
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
