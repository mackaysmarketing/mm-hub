/**
 * I/O for the run report: gathers data from Supabase and resolveRules(),
 * shapes it into RawReportData, and hands off to the pure buildReportModel()
 * in reportModel.ts. Not unit tested — verified via typecheck + a dev-server
 * smoke test, same as resolveRules.ts and consignorAssign/index.ts.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRules } from "../consignorAssign/resolveRules";
import { DECISION_SKIP_REASONS } from "../consignorAssign/decisionReasons";
import {
  resolvePeriodBoundary,
  buildReportModel,
  type RawReportData,
  type RawAttentionHistoryRow,
  type RawActionRow,
  type RuleLabelInfo,
} from "./reportModel";
import type { ReportModel, RuleHealthIssue } from "./emailTemplate";

const ASSIGN_PROCESS_KEY = "consignor_auto_assign";
const REPORT_PROCESS_KEY = "consignor_auto_assign_report";

// Shared with the Tools overview endpoint and the per-run conflict alert —
// see decisionReasons.ts for what qualifies and why.

const ATTENTION_HISTORY_DAYS = 30; // window for the "seen in N runs" repeat count

interface ProcessDefSelectRow {
  enabled: boolean;
  mode: string;
}
interface ReportDefSelectRow {
  config: Record<string, unknown> | null;
}
interface LatestRunSelectRow {
  id: string;
  trigger: "cron" | "manual";
  started_at: string;
  candidates_seen: number;
}
interface AttentionSelectRow {
  target_id: string;
  target_ref: string | null;
  consignee_name: string | null;
  skip_reason: string | null;
}
interface AttentionHistorySelectRow {
  target_id: string;
  run_id: string;
}
interface ActionSelectRow {
  target_ref: string | null;
  consignee_name: string | null;
  rule_id: string | null;
  after: { code?: string } | null;
  created_at: string;
}
interface FailureSelectRow {
  target_ref: string | null;
  consignee_name: string | null;
  error: string | null;
  created_at: string;
}
interface RuleLabelSelectRow {
  id: string;
  consignee_entity_code: string | null;
  crop_name: string | null;
}

function toRawActionRow(row: ActionSelectRow): RawActionRow {
  return {
    targetRef: row.target_ref,
    consigneeName: row.consignee_name,
    consignorCode: row.after?.code ?? null,
    ruleId: row.rule_id,
    createdAt: row.created_at,
  };
}

export async function fetchRawReportData(): Promise<RawReportData> {
  const admin = createAdminClient();
  const now = new Date();

  const [{ data: assignDefRaw }, { data: reportDefRaw }, { data: latestRunRaw }, ruleValidation] =
    await Promise.all([
      admin
        .from("process_definitions")
        .select("enabled, mode")
        .eq("key", ASSIGN_PROCESS_KEY)
        .maybeSingle(),
      admin
        .from("process_definitions")
        .select("config")
        .eq("key", REPORT_PROCESS_KEY)
        .maybeSingle(),
      admin
        .from("process_runs")
        .select("id, trigger, started_at, candidates_seen")
        .eq("process_key", ASSIGN_PROCESS_KEY)
        .neq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      resolveRules(),
    ]);

  const assignDef = assignDefRaw as ProcessDefSelectRow | null;
  const reportDef = reportDefRaw as ReportDefSelectRow | null;
  const latestRunRow = latestRunRaw as LatestRunSelectRow | null;

  const { data: lastReportRaw } = await admin
    .from("process_runs")
    .select("completed_at")
    .eq("process_key", REPORT_PROCESS_KEY)
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { periodStart, queryBoundary } = resolvePeriodBoundary(
    (lastReportRaw as { completed_at: string } | null)?.completed_at ?? null,
    now
  );
  const periodEnd = now.toISOString();
  const historyBoundary = new Date(now.getTime() - ATTENTION_HISTORY_DAYS * 86_400_000).toISOString();
  const latestRunId = latestRunRow?.id ?? null;

  const [attentionRes, historyRes, proposedRes, appliedRes, failedRes, runsCountRes] =
    await Promise.all([
      latestRunId
        ? admin
            .from("process_actions")
            .select("target_id, target_ref, consignee_name, skip_reason")
            .eq("run_id", latestRunId)
            .in("skip_reason", DECISION_SKIP_REASONS)
        : Promise.resolve({ data: [] as AttentionSelectRow[] | null, error: null }),
      admin
        .from("process_actions")
        .select("target_id, run_id")
        .eq("process_key", ASSIGN_PROCESS_KEY)
        .in("skip_reason", DECISION_SKIP_REASONS)
        .gte("created_at", historyBoundary),
      latestRunId
        ? admin
            .from("process_actions")
            .select("target_ref, consignee_name, rule_id, after, created_at")
            .eq("run_id", latestRunId)
            .eq("status", "proposed")
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as ActionSelectRow[] | null, error: null }),
      admin
        .from("process_actions")
        .select("target_ref, consignee_name, rule_id, after, created_at")
        .eq("process_key", ASSIGN_PROCESS_KEY)
        .eq("status", "applied")
        .gte("created_at", queryBoundary)
        .order("created_at", { ascending: true }),
      admin
        .from("process_actions")
        .select("target_ref, consignee_name, error, created_at")
        .eq("process_key", ASSIGN_PROCESS_KEY)
        .eq("status", "failed")
        .gte("created_at", queryBoundary)
        .order("created_at", { ascending: true }),
      admin
        .from("process_runs")
        .select("id", { count: "exact", head: true })
        .eq("process_key", ASSIGN_PROCESS_KEY)
        .gte("started_at", queryBoundary),
    ]);

  const currentAttention = (attentionRes.data ?? []) as AttentionSelectRow[];
  const attentionHistory = (historyRes.data ?? []) as AttentionHistorySelectRow[];
  const latestProposed = (proposedRes.data ?? []) as ActionSelectRow[];
  const appliedSincePeriod = (appliedRes.data ?? []) as ActionSelectRow[];
  const failedSincePeriod = (failedRes.data ?? []) as FailureSelectRow[];

  const ruleIds = new Set<string>();
  for (const row of latestProposed) if (row.rule_id) ruleIds.add(row.rule_id);
  for (const row of appliedSincePeriod) if (row.rule_id) ruleIds.add(row.rule_id);

  const ruleLabelsById = new Map<string, RuleLabelInfo>();
  if (ruleIds.size > 0) {
    const { data: ruleRowsRaw } = await admin
      .from("consignor_assignment_rules")
      .select("id, consignee_entity_code, crop_name")
      .in("id", Array.from(ruleIds));
    for (const r of (ruleRowsRaw ?? []) as RuleLabelSelectRow[]) {
      ruleLabelsById.set(r.id, { consigneeEntityCode: r.consignee_entity_code, cropName: r.crop_name });
    }
  }

  const attentionHistoryRows: RawAttentionHistoryRow[] = attentionHistory.map((row) => ({
    targetId: row.target_id,
    runId: row.run_id,
  }));

  return {
    assignProcessEnabled: assignDef?.enabled ?? false,
    assignProcessMode: assignDef?.mode === "apply" ? "apply" : assignDef?.mode === "dry_run" ? "dry_run" : null,
    reportScheduleRaw: reportDef?.config?.schedule ?? null,
    latestRun: latestRunRow
      ? {
          trigger: latestRunRow.trigger,
          startedAt: latestRunRow.started_at,
          candidatesSeen: latestRunRow.candidates_seen,
        }
      : null,
    periodStart,
    periodEnd,
    ruleHealth: {
      validCount: ruleValidation.validRules.length,
      totalCount: ruleValidation.validRules.length + ruleValidation.invalidRules.length,
      issues: ruleValidation.invalidRules.map(
        (r): RuleHealthIssue => ({
          customerLabel: r.rule.consignee_entity_code ?? "Any customer",
          consignorCode: r.rule.consignor_entity_code,
          reason: r.reason,
        })
      ),
    },
    currentAttention: currentAttention.map((row) => ({
      targetId: row.target_id,
      targetRef: row.target_ref,
      consigneeName: row.consignee_name,
      skipReason: row.skip_reason,
    })),
    attentionHistory: attentionHistoryRows,
    latestProposed: latestProposed.map(toRawActionRow),
    appliedSincePeriod: appliedSincePeriod.map(toRawActionRow),
    failedSincePeriod: failedSincePeriod.map((row) => ({
      targetRef: row.target_ref,
      consigneeName: row.consignee_name,
      error: row.error,
      createdAt: row.created_at,
    })),
    ruleLabelsById,
    runsInPeriod: runsCountRes.count ?? 0,
  };
}

/** Convenience entry point for runReport/index.ts: fetch + shape in one call. */
export async function queryReportData(): Promise<ReportModel> {
  const raw = await fetchRawReportData();
  return buildReportModel(raw);
}
