/**
 * Orchestration for the "Auto FT Consignor Update — run report" process:
 * query the data, build the model, render the HTML, and email it. Unlike
 * consignorAssign, this process never touches FreshTrack or process_actions
 * — its only side effect is one outbound email — so there's nothing to log
 * per-candidate; the whole outcome (recipient, subject, message id) goes in
 * process_runs.payload instead. Any failure (missing recipient config, a
 * Resend error) is left to propagate to runProcess()'s own catch, the same
 * way an unhandled FreshTrack error propagates out of consignorAssign/index.ts.
 *
 * `mode` (dry_run/apply) is part of the generic process_definitions shape but
 * has no meaning for a report — it neither proposes nor applies anything to
 * FreshTrack. Migration 00019 seeds it as an inert placeholder; this function
 * ignores it entirely.
 */
import "server-only";
import { queryReportData } from "./queryReportData";
import { buildReportSubject, renderReportHtml } from "./emailTemplate";
import { sendEmail } from "@/lib/resend";
import type { RunSummary, ProcessMode } from "../runner";

type RunResult = Omit<RunSummary, "status"> & { partial?: boolean };

const EMPTY_COUNTS = {
  candidatesSeen: 0,
  actionsProposed: 0,
  actionsApplied: 0,
  actionsSkipped: 0,
  actionsFailed: 0,
} as const;

export async function runConsignorReport(ctx: {
  runId: string;
  processKey: string;
  mode: ProcessMode;
  config: Record<string, unknown>;
}): Promise<RunResult> {
  const recipient =
    typeof ctx.config.recipient_email === "string" ? ctx.config.recipient_email : null;
  if (!recipient) {
    throw new Error("consignor_auto_assign_report.config.recipient_email is not set");
  }

  const model = await queryReportData();
  const subject = buildReportSubject(model);
  const html = renderReportHtml(model);
  const sent = await sendEmail({ to: recipient, subject, html });

  return {
    ...EMPTY_COUNTS,
    payload: {
      recipient,
      subject,
      message_id: sent.id,
      needs_attention_count: model.needsAttention.length,
      failures_count: model.failures.length,
      assignments_count: model.assignments.length,
      rule_issues_count: model.ruleHealth.issues.length,
    },
  };
}
