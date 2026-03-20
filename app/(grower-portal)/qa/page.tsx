"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Calendar,
  ClipboardList,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/hooks/use-user";

interface CategoryScore {
  id: string;
  category: string;
  score: number;
  max_score: number;
  status: string;
  findings: string | null;
  action_required: string | null;
  due_date: string | null;
}

interface ActionItem {
  id: string;
  category: string;
  action: string | null;
  status: string;
  dueDate: string | null;
}

interface Audit {
  id: string;
  audit_type: string;
  scheduled_date: string | null;
  completed_date: string | null;
  auditor: string | null;
  result: string | null;
  certificate_expiry: string | null;
  notes: string | null;
}

interface Assessment {
  id: string;
  assessment_date: string;
  overall_score: number | null;
  status: string | null;
  notes: string | null;
}

interface QAOverviewResponse {
  assessment: Assessment | null;
  categoryScores: CategoryScore[];
  actionItems: ActionItem[];
  upcomingAudits: Audit[];
}

function getStatusColor(status: string | null) {
  switch (status) {
    case "compliant":
    case "pass":
      return "text-canopy";
    case "at_risk":
    case "warning":
      return "text-harvest";
    case "non_compliant":
    case "fail":
      return "text-blaze";
    default:
      return "text-stone";
  }
}

function getStatusBgColor(status: string | null) {
  switch (status) {
    case "compliant":
    case "pass":
      return "bg-canopy/10";
    case "at_risk":
    case "warning":
      return "bg-harvest/15";
    case "non_compliant":
    case "fail":
      return "bg-blaze/10";
    default:
      return "bg-sand/60";
  }
}

function getStatusIcon(status: string | null) {
  switch (status) {
    case "compliant":
    case "pass":
      return <CheckCircle2 className="h-4 w-4 text-canopy" />;
    case "at_risk":
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-harvest" />;
    case "non_compliant":
    case "fail":
      return <XCircle className="h-4 w-4 text-blaze" />;
    default:
      return <ShieldCheck className="h-4 w-4 text-stone" />;
  }
}

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "compliant":
      return "Compliant";
    case "at_risk":
      return "At Risk";
    case "non_compliant":
      return "Non-Compliant";
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Fail";
    default:
      return "Unknown";
  }
}

/** Circular progress gauge SVG */
function HealthGauge({ score, status }: { score: number; status: string | null }) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(score, 0), 100);
  const offset = circumference - (pct / 100) * circumference;

  const strokeColor =
    status === "compliant" || status === "pass"
      ? "#1A5C34"
      : status === "at_risk" || status === "warning"
        ? "#D4A017"
        : status === "non_compliant" || status === "fail"
          ? "#C8302C"
          : "#9C9690";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="160" height="160" className="-rotate-90">
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke="#E8E4DE"
          strokeWidth="12"
          fill="none"
        />
        <circle
          cx="80"
          cy="80"
          r={radius}
          stroke={strokeColor}
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-soil">{pct}</span>
        <span className="text-xs text-stone">/ 100</span>
      </div>
    </div>
  );
}

export default function QAPage() {
  const { session } = useUser();

  const portalAccess = session?.moduleAccess.find(
    (m) => m.module_id === "grower-portal"
  );
  const growerId =
    (portalAccess?.config as { grower_id?: string })?.grower_id ?? undefined;

  function buildParams(): string {
    const params = new URLSearchParams();
    if (growerId) params.set("growerId", growerId);
    return params.toString();
  }

  const queryParams = buildParams();

  const { data, isLoading } = useQuery<QAOverviewResponse>({
    queryKey: ["qa-overview", queryParams],
    queryFn: () =>
      fetch(`/api/qa/overview?${queryParams}`).then((r) => r.json()),
  });

  const assessment = data?.assessment ?? null;
  const categoryScores = data?.categoryScores ?? [];
  const actionItems = data?.actionItems ?? [];
  const upcomingAudits = data?.upcomingAudits ?? [];

  return (
    <div className="space-y-6">
      <TopBar title="QA & Compliance" />

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Skeleton className="h-[240px] rounded-xl" />
            <Skeleton className="h-[240px] rounded-xl lg:col-span-2" />
          </div>
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
      ) : !assessment ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite py-16 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-stone/50" />
          <p className="text-sm text-stone">No QA assessments found</p>
          <p className="mt-1 text-xs text-stone/70">
            QA data will appear here once an assessment has been completed
          </p>
        </div>
      ) : (
        <>
          {/* Top row: Health score gauge + Category scores */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Health Score Gauge */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-sand bg-warmwhite p-6">
              <h2 className="mb-4 text-sm font-semibold text-soil">
                Health Score
              </h2>
              <HealthGauge
                score={assessment.overall_score ?? 0}
                status={assessment.status}
              />
              <div className="mt-4 flex items-center gap-1.5">
                {getStatusIcon(assessment.status)}
                <span
                  className={`text-sm font-medium ${getStatusColor(assessment.status)}`}
                >
                  {getStatusLabel(assessment.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-stone">
                Assessed{" "}
                {new Date(assessment.assessment_date).toLocaleDateString(
                  "en-AU",
                  { day: "numeric", month: "short", year: "numeric" }
                )}
              </p>
            </div>

            {/* Category Scores */}
            <div className="rounded-xl border border-sand bg-warmwhite p-5 lg:col-span-2">
              <h2 className="mb-4 text-sm font-semibold text-soil">
                Category Scores
              </h2>
              {categoryScores.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone">
                  No category scores available
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {categoryScores.map((cs) => {
                    const pct =
                      cs.max_score > 0
                        ? Math.round((cs.score / cs.max_score) * 100)
                        : 0;
                    return (
                      <div
                        key={cs.id}
                        className={`rounded-lg p-3 ${getStatusBgColor(cs.status)}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(cs.status)}
                            <span className="text-sm font-medium text-soil">
                              {cs.category}
                            </span>
                          </div>
                          <span className="text-sm font-bold text-soil">
                            {pct}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/60">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              cs.status === "pass"
                                ? "bg-canopy"
                                : cs.status === "warning"
                                  ? "bg-harvest"
                                  : cs.status === "fail"
                                    ? "bg-blaze"
                                    : "bg-stone"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {cs.findings && (
                          <p className="mt-1.5 text-xs text-bark">
                            {cs.findings}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Action Items */}
          <div className="rounded-xl border border-sand bg-warmwhite p-5">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-soil" />
              <h2 className="text-sm font-semibold text-soil">Action Items</h2>
            </div>
            {actionItems.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-canopy/5 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-canopy" />
                <p className="text-sm text-canopy">
                  No outstanding action items
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {actionItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-lg border border-sand/60 p-3"
                  >
                    {getStatusIcon(item.status)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-soil">{item.action}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-stone">
                        <span className="rounded bg-sand/60 px-1.5 py-0.5">
                          {item.category}
                        </span>
                        {item.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Due{" "}
                            {new Date(item.dueDate).toLocaleDateString(
                              "en-AU",
                              { day: "numeric", month: "short" }
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Audits */}
          <div className="rounded-xl border border-sand bg-warmwhite p-5">
            <div className="mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-soil" />
              <h2 className="text-sm font-semibold text-soil">
                Upcoming Audits
              </h2>
            </div>
            {upcomingAudits.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone">
                No upcoming audits scheduled
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sand text-xs text-stone">
                      <th className="pb-2 pr-4 font-medium">Type</th>
                      <th className="pb-2 pr-4 font-medium">Scheduled</th>
                      <th className="pb-2 pr-4 font-medium">Auditor</th>
                      <th className="pb-2 pr-4 font-medium">
                        Certificate Expiry
                      </th>
                      <th className="pb-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingAudits.map((audit) => (
                      <tr
                        key={audit.id}
                        className="border-b border-sand/50 last:border-0"
                      >
                        <td className="py-2.5 pr-4 font-medium text-soil">
                          {audit.audit_type}
                        </td>
                        <td className="py-2.5 pr-4 text-bark">
                          {audit.scheduled_date
                            ? new Date(
                                audit.scheduled_date
                              ).toLocaleDateString("en-AU", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "TBD"}
                        </td>
                        <td className="py-2.5 pr-4 text-bark">
                          {audit.auditor ?? "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-bark">
                          {audit.certificate_expiry
                            ? new Date(
                                audit.certificate_expiry
                              ).toLocaleDateString("en-AU", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="py-2.5 text-xs text-stone">
                          {audit.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
