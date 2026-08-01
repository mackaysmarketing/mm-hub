/**
 * Pure model-shaping for the run report — no I/O, no `server-only` (so it can
 * be unit tested directly, the same reason matchOrder.ts/guards.ts/schedule.ts
 * are split out from their I/O callers). queryReportData.ts fetches the raw
 * data this consumes.
 *
 * STATE-SNAPSHOT vs EVENT split (see ReportModel's own field comments): rule
 * health, needs-attention conflicts, and dry-run "ready to assign" all
 * reflect only the LATEST run. Applied writes and failures are PERIOD-scoped
 * events, since the last successful report send (or a default lookback
 * before the very first report has ever gone out).
 */
import { parseSchedule, describeSchedule } from "../schedule";
import type {
  ReportModel,
  RuleHealthIssue,
  NeedsAttentionItem,
  AssignmentItem,
  FailureItem,
} from "./emailTemplate";

export const HUB_URL = "https://hub.mackaysmarketing.com.au/tools/consignor-auto-assign";

const REASON_LABELS: Record<string, string> = {
  ambiguous_multi_crop: "Mixed crops, different consignors",
  no_rule_matched: "No matching rule",
};

export const DEFAULT_LOOKBACK_DAYS = 7; // only used before the very first report has ever sent

// ---------------------------------------------------------------- raw shape

export interface RawAttentionRow {
  targetId: string;
  targetRef: string | null;
  consigneeName: string | null;
  skipReason: string | null;
}

export interface RawAttentionHistoryRow {
  targetId: string;
  runId: string;
}

export interface RawActionRow {
  targetRef: string | null;
  consigneeName: string | null;
  consignorCode: string | null; // extracted from process_actions.after.code
  ruleId: string | null;
  createdAt: string;
}

export interface RawFailureRow {
  targetRef: string | null;
  consigneeName: string | null;
  error: string | null;
  createdAt: string;
}

export interface RuleLabelInfo {
  consigneeEntityCode: string | null;
  cropName: string | null;
}

export interface RawReportData {
  assignProcessEnabled: boolean;
  assignProcessMode: "dry_run" | "apply" | null; // null = process_definitions row missing
  reportScheduleRaw: unknown;
  latestRun: { trigger: "cron" | "manual"; startedAt: string; candidatesSeen: number } | null;
  periodStart: string | null; // null = first-ever report — see resolvePeriodBoundary
  periodEnd: string;
  ruleHealth: { validCount: number; totalCount: number; issues: RuleHealthIssue[] };
  currentAttention: RawAttentionRow[];
  attentionHistory: RawAttentionHistoryRow[];
  latestProposed: RawActionRow[]; // populated only when the process is in dry_run mode
  appliedSincePeriod: RawActionRow[]; // populated only when the process is in apply mode
  failedSincePeriod: RawFailureRow[];
  ruleLabelsById: Map<string, RuleLabelInfo>;
  runsInPeriod: number;
}

// --------------------------------------------------------------- pure logic

/**
 * `lastSuccessfulReportAt` is the completed_at of the last 'success' report
 * run, or null if the report has never sent. `now` is taken explicitly (not
 * read internally) so this is testable without touching the clock, the same
 * way isRunDue takes `nowUtc` explicitly.
 */
export function resolvePeriodBoundary(
  lastSuccessfulReportAt: string | null,
  now: Date,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): { periodStart: string | null; queryBoundary: string } {
  if (lastSuccessfulReportAt) {
    return { periodStart: lastSuccessfulReportAt, queryBoundary: lastSuccessfulReportAt };
  }
  return {
    periodStart: null,
    queryBoundary: new Date(now.getTime() - lookbackDays * 86_400_000).toISOString(),
  };
}

function ruleLabelFor(info: RuleLabelInfo | undefined): string | null {
  if (!info) return null;
  const customer = info.consigneeEntityCode ?? "Any customer";
  const crop = info.cropName ?? "any crop";
  return `${customer} + ${crop}`;
}

/** How many DISTINCT runs has each target_id shown up in, within the history window. */
function countRunsByTarget(history: RawAttentionHistoryRow[]): Map<string, number> {
  const runsByTarget = new Map<string, Set<string>>();
  for (const row of history) {
    const set = runsByTarget.get(row.targetId) ?? new Set<string>();
    set.add(row.runId);
    runsByTarget.set(row.targetId, set);
  }
  const counts = new Map<string, number>();
  runsByTarget.forEach((runIds, targetId) => counts.set(targetId, runIds.size));
  return counts;
}

function toAssignmentItem(row: RawActionRow, ruleLabelsById: Map<string, RuleLabelInfo>): AssignmentItem {
  return {
    orderRef: row.targetRef ?? "unknown order",
    consigneeName: row.consigneeName,
    consignorCode: row.consignorCode ?? "unknown",
    ruleLabel: ruleLabelFor(row.ruleId ? ruleLabelsById.get(row.ruleId) : undefined),
    at: row.createdAt,
  };
}

export function buildReportModel(raw: RawReportData, hubUrl: string = HUB_URL): ReportModel {
  const mode: "dry_run" | "apply" = raw.assignProcessMode === "apply" ? "apply" : "dry_run";

  const seenCounts = countRunsByTarget(raw.attentionHistory);
  const needsAttention: NeedsAttentionItem[] = raw.currentAttention.map((row) => ({
    orderRef: row.targetRef ?? row.targetId,
    consigneeName: row.consigneeName,
    reasonLabel: REASON_LABELS[row.skipReason ?? ""] ?? row.skipReason ?? "Unknown reason",
    seenInRuns: seenCounts.get(row.targetId) ?? 1,
  }));

  // dry_run's "assignments" is a snapshot of the latest run's proposals, not
  // an accumulating log — a still-pending order shouldn't be re-counted every
  // report. apply's "assignments" are real writes, so they're a genuine
  // period-scoped event log across every run since the last report.
  const assignmentRows = mode === "apply" ? raw.appliedSincePeriod : raw.latestProposed;
  const assignments = assignmentRows.map((row) => toAssignmentItem(row, raw.ruleLabelsById));

  const failures: FailureItem[] = raw.failedSincePeriod.map((row) => ({
    orderRef: row.targetRef ?? "unknown order",
    consigneeName: row.consigneeName,
    error: row.error ?? "Unknown error",
    at: row.createdAt,
  }));

  const schedule = parseSchedule(raw.reportScheduleRaw);

  return {
    mode,
    processEnabled: raw.assignProcessEnabled,
    generatedAt: raw.periodEnd,
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    latestRun: raw.latestRun,
    ruleHealth: raw.ruleHealth,
    failures,
    needsAttention,
    assignments,
    runsInPeriod: raw.runsInPeriod,
    scheduleLabel: schedule ? describeSchedule(schedule) : "on its configured schedule",
    hubUrl,
  };
}
