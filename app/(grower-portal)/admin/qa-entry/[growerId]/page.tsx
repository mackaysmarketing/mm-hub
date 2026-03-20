"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const DEFAULT_CATEGORIES = [
  "Food Safety",
  "Certification",
  "Traceability",
  "Chemical Management",
  "Environmental",
  "Workplace Health & Safety",
];

const AUDIT_TYPES = ["HARPS", "Freshcare", "GlobalGAP", "Internal"];

interface CategoryEntry {
  category: string;
  score: string;
  max_score: string;
  statusOverride: string;
  findings: string;
  action_required: string;
  due_date: string;
}

function deriveStatus(score: number, maxScore: number): string {
  if (maxScore <= 0) return "pass";
  const pct = (score / maxScore) * 100;
  if (pct >= 80) return "pass";
  if (pct >= 60) return "warning";
  return "fail";
}

function statusLabel(s: string): string {
  if (s === "pass") return "Pass";
  if (s === "warning") return "Warning";
  if (s === "fail") return "Fail";
  return s;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-canopy" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-harvest" />;
  return <XCircle className="h-4 w-4 text-blaze" />;
}

function makeEmptyCategory(name: string): CategoryEntry {
  return {
    category: name,
    score: "",
    max_score: "100",
    statusOverride: "",
    findings: "",
    action_required: "",
    due_date: "",
  };
}

export default function QAEntryGrowerPage() {
  const params = useParams<{ growerId: string }>();
  const router = useRouter();

  // Fetch grower name
  const { data: grower, isLoading: growerLoading } = useQuery<{
    name: string;
    code: string;
  }>({
    queryKey: ["admin-grower-detail", params.growerId],
    queryFn: () =>
      fetch(`/api/grower-portal/admin/growers/${params.growerId}`).then((r) =>
        r.json()
      ),
  });

  // Assessment form state
  const [assessmentDate, setAssessmentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [categories, setCategories] = useState<CategoryEntry[]>(
    DEFAULT_CATEGORIES.map(makeEmptyCategory)
  );

  // Audit scheduling
  const [scheduleAudit, setScheduleAudit] = useState(false);
  const [auditType, setAuditType] = useState("HARPS");
  const [auditDate, setAuditDate] = useState("");
  const [auditor, setAuditor] = useState("");
  const [auditNotes, setAuditNotes] = useState("");

  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Computed overall score
  const { overallScore, overallStatus } = useMemo(() => {
    const scored = categories.filter(
      (c) => c.score !== "" && c.max_score !== ""
    );
    if (scored.length === 0) return { overallScore: null, overallStatus: null };

    const avg =
      scored.reduce((sum, c) => {
        const pct = (Number(c.score) / Number(c.max_score)) * 100;
        return sum + pct;
      }, 0) / scored.length;

    const status =
      avg >= 80 ? "compliant" : avg >= 60 ? "at_risk" : "non_compliant";

    return { overallScore: Math.round(avg * 10) / 10, overallStatus: status };
  }, [categories]);

  function updateCategory(index: number, field: string, value: string) {
    setCategories((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  function removeCategory(index: number) {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  }

  function addCategory() {
    setCategories((prev) => [...prev, makeEmptyCategory("")]);
  }

  // Submit
  const submitMutation = useMutation({
    mutationFn: async () => {
      // Submit assessment
      const catPayload = categories
        .filter((c) => c.category.trim() && c.score !== "")
        .map((c) => ({
          category: c.category,
          score: Number(c.score),
          max_score: Number(c.max_score) || 100,
          status: c.statusOverride || undefined,
          findings: c.findings || undefined,
          action_required: c.action_required || undefined,
          due_date: c.due_date || undefined,
        }));

      const res = await fetch("/api/grower-portal/admin/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grower_id: params.growerId,
          assessment_date: assessmentDate,
          overall_score: overallScore ?? 0,
          status: overallStatus ?? undefined,
          notes: notes || undefined,
          categories: catPayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save assessment");
      }

      // Optionally schedule audit
      if (scheduleAudit && auditDate) {
        const auditRes = await fetch(
          "/api/grower-portal/admin/qa/audits",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grower_id: params.growerId,
              audit_type: auditType,
              scheduled_date: auditDate,
              auditor: auditor || undefined,
              notes: auditNotes || undefined,
            }),
          }
        );
        if (!auditRes.ok) {
          const err = await auditRes.json();
          throw new Error(err.error || "Assessment saved but failed to schedule audit");
        }
      }

      return true;
    },
    onSuccess: () => {
      setSubmitSuccess(true);
      setTimeout(() => router.push("/admin/qa-entry"), 1000);
    },
  });

  const validCategories = categories.filter(
    (c) => c.category.trim() && c.score !== ""
  );
  const allScoresValid = validCategories.every((c) => {
    const s = Number(c.score);
    const m = Number(c.max_score) || 100;
    return s >= 0 && s <= m;
  });
  const canSubmit =
    assessmentDate &&
    validCategories.length > 0 &&
    allScoresValid &&
    !submitMutation.isPending;

  if (growerLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/qa-entry"
        className="inline-flex items-center gap-1.5 text-sm text-stone transition-colors hover:text-soil"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to QA assessments
      </Link>

      <TopBar
        title={`QA Assessment — ${grower?.name ?? "Grower"}`}
      />

      {submitSuccess && (
        <div className="rounded-lg bg-canopy/10 px-4 py-3 text-sm text-canopy">
          Assessment saved successfully. Redirecting...
        </div>
      )}

      {/* Assessment details */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <h2 className="mb-4 text-sm font-semibold text-soil">
          Assessment Details
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-bark">
              Assessment Date *
            </label>
            <Input
              type="date"
              value={assessmentDate}
              onChange={(e) => setAssessmentDate(e.target.value)}
              className="border-sand bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-bark">
              General Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-sand bg-white px-3 py-2 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
            />
          </div>
        </div>
      </div>

      {/* Overall score display */}
      {overallScore !== null && (
        <div className="flex items-center gap-4 rounded-xl border border-sand bg-warmwhite px-6 py-4">
          <div className="text-sm text-bark">Overall Score:</div>
          <div
            className={`text-2xl font-bold ${
              overallStatus === "compliant"
                ? "text-canopy"
                : overallStatus === "at_risk"
                  ? "text-harvest"
                  : "text-blaze"
            }`}
          >
            {overallScore}
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              overallStatus === "compliant"
                ? "bg-canopy/10 text-canopy"
                : overallStatus === "at_risk"
                  ? "bg-harvest/15 text-harvest"
                  : "bg-blaze/10 text-blaze"
            }`}
          >
            {overallStatus === "compliant"
              ? "Compliant"
              : overallStatus === "at_risk"
                ? "At Risk"
                : "Non-Compliant"}
          </span>
        </div>
      )}

      {/* Category scores */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">Category Scores</h2>
          <Button
            size="sm"
            variant="outline"
            className="border-sand text-bark"
            onClick={addCategory}
          >
            <Plus className="h-4 w-4" />
            Add Category
          </Button>
        </div>

        <div className="space-y-4">
          {categories.map((cat, idx) => {
            const score = Number(cat.score) || 0;
            const maxScore = Number(cat.max_score) || 100;
            const catStatus =
              cat.statusOverride ||
              (cat.score !== "" ? deriveStatus(score, maxScore) : "pass");

            return (
              <div
                key={idx}
                className="rounded-lg border border-sand/80 p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {cat.score !== "" && <StatusIcon status={catStatus} />}
                    {DEFAULT_CATEGORIES.includes(cat.category) ? (
                      <span className="text-sm font-medium text-soil">
                        {cat.category}
                      </span>
                    ) : (
                      <Input
                        value={cat.category}
                        onChange={(e) =>
                          updateCategory(idx, "category", e.target.value)
                        }
                        placeholder="Category name"
                        className="h-7 w-48 border-sand bg-white text-sm"
                      />
                    )}
                  </div>
                  <button
                    onClick={() => removeCategory(idx)}
                    className="text-xs text-blaze transition-colors hover:text-blaze/80"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Score (0-{cat.max_score || 100})
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max={cat.max_score || "100"}
                      value={cat.score}
                      onChange={(e) =>
                        updateCategory(idx, "score", e.target.value)
                      }
                      className="border-sand bg-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Max Score
                    </label>
                    <Input
                      type="number"
                      min="1"
                      value={cat.max_score}
                      onChange={(e) =>
                        updateCategory(idx, "max_score", e.target.value)
                      }
                      className="border-sand bg-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Status Override
                    </label>
                    <select
                      value={cat.statusOverride}
                      onChange={(e) =>
                        updateCategory(idx, "statusOverride", e.target.value)
                      }
                      className="h-9 w-full rounded-md border border-sand bg-white px-2 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
                    >
                      <option value="">
                        Auto ({cat.score !== "" ? statusLabel(deriveStatus(score, maxScore)) : "—"})
                      </option>
                      <option value="pass">Pass</option>
                      <option value="warning">Warning</option>
                      <option value="fail">Fail</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Action Due Date
                    </label>
                    <Input
                      type="date"
                      value={cat.due_date}
                      onChange={(e) =>
                        updateCategory(idx, "due_date", e.target.value)
                      }
                      className="border-sand bg-white"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Findings
                    </label>
                    <textarea
                      value={cat.findings}
                      onChange={(e) =>
                        updateCategory(idx, "findings", e.target.value)
                      }
                      rows={2}
                      className="w-full rounded-md border border-sand bg-white px-3 py-1.5 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-stone">
                      Action Required
                    </label>
                    <textarea
                      value={cat.action_required}
                      onChange={(e) =>
                        updateCategory(idx, "action_required", e.target.value)
                      }
                      rows={2}
                      className="w-full rounded-md border border-sand bg-white px-3 py-1.5 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audit scheduling */}
      <div className="rounded-xl border border-sand bg-warmwhite p-6">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={scheduleAudit}
            onChange={(e) => setScheduleAudit(e.target.checked)}
            className="h-4 w-4 rounded border-sand text-forest focus:ring-forest"
          />
          <span className="text-sm font-semibold text-soil">
            Schedule an audit
          </span>
        </label>

        {scheduleAudit && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                Audit Type
              </label>
              <select
                value={auditType}
                onChange={(e) => setAuditType(e.target.value)}
                className="h-9 w-full rounded-md border border-sand bg-white px-2 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
              >
                {AUDIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                Scheduled Date
              </label>
              <Input
                type="date"
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                Auditor
              </label>
              <Input
                value={auditor}
                onChange={(e) => setAuditor(e.target.value)}
                placeholder="Auditor name"
                className="border-sand bg-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-bark">
                Notes
              </label>
              <Input
                value={auditNotes}
                onChange={(e) => setAuditNotes(e.target.value)}
                className="border-sand bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          className="bg-canopy text-white hover:bg-canopy/90"
          disabled={!canSubmit}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? "Saving..." : "Save Assessment"}
        </Button>
        {submitMutation.isError && (
          <span className="text-xs text-blaze">
            {submitMutation.error?.message}
          </span>
        )}
      </div>
    </div>
  );
}
