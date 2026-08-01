/**
 * Per-run conflict alert: the exception channel for "an order arrived that
 * the rules can't resolve, and a human has to decide".
 *
 * Fires at the end of every assign run — cron or manual, dry_run or apply —
 * but only for orders it has never alerted on before. A conflicted order stays
 * conflicted until someone acts, so it is re-flagged on every subsequent run;
 * alerting on each sighting would have sent 18 identical emails about the one
 * genuinely ambiguous order seen in the first three days of live running.
 * Novelty is therefore the trigger, and the scheduled summary report remains
 * the place where everything still outstanding is listed.
 *
 * "Never alerted before" is judged against process_actions across all earlier
 * runs. That's sound here because resolution is terminal: once an order has a
 * consignor it stops being a candidate at all (discovery filters on
 * consignorId === null), so an order cannot realistically re-enter conflict
 * after being fixed.
 *
 * This function NEVER throws. A missing recipient or a Resend outage must not
 * fail a run that successfully wrote to FreshTrack — the outcome is recorded
 * in process_runs.payload.conflict_alert instead, so a silent failure is still
 * visible in the activity log.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/resend";
import { validateRecipients } from "../runReport/recipients";
import { DECISION_SKIP_REASONS, decisionReasonLabel } from "./decisionReasons";
import {
  buildConflictAlertSubject,
  renderConflictAlertHtml,
  type ConflictAlertItem,
  type ConflictAlertModel,
} from "./conflictAlertTemplate";

// Recipients and the on/off switch live on the report definition's config,
// alongside recipient_email — the "Email reports" tab owns every outbound
// email this tool sends. Deliberately independent of that process's own
// `enabled` flag: switching the routine summary off must not silently switch
// off the exception alerts too.
const REPORT_PROCESS_KEY = "consignor_auto_assign_report";

export interface ConflictCandidate {
  targetId: string;
  targetRef: string | null;
  consigneeName: string | null;
  skipReason: string;
}

export async function maybeSendConflictAlert(input: {
  runId: string;
  mode: "dry_run" | "apply";
  conflicts: ConflictCandidate[];
}): Promise<Record<string, unknown> | undefined> {
  if (input.conflicts.length === 0) return undefined;

  try {
    const admin = createAdminClient();

    const { data: def, error: defError } = await admin
      .from("process_definitions")
      .select("config")
      .eq("key", REPORT_PROCESS_KEY)
      .maybeSingle();
    if (defError) throw new Error(defError.message);

    const config = (def?.config ?? {}) as Record<string, unknown>;
    // Absent means on: the alert is a safety net, so it should have to be
    // switched off deliberately rather than by omission.
    if (config.alert_on_conflicts === false) {
      return { sent: false, reason: "disabled", conflicts_found: input.conflicts.length };
    }

    const targetIds = input.conflicts.map((c) => c.targetId);
    const { data: priorRows, error: priorError } = await admin
      .from("process_actions")
      .select("target_id")
      .in("skip_reason", DECISION_SKIP_REASONS)
      .in("target_id", targetIds)
      .neq("run_id", input.runId);
    if (priorError) throw new Error(priorError.message);

    const alreadyAlerted = new Set(
      (priorRows ?? []).map((r) => (r as { target_id: string }).target_id)
    );
    const fresh = input.conflicts.filter((c) => !alreadyAlerted.has(c.targetId));

    if (fresh.length === 0) {
      return {
        sent: false,
        reason: "no_new_conflicts",
        conflicts_found: input.conflicts.length,
        suppressed_as_repeat: input.conflicts.length,
      };
    }

    const rawRecipients =
      typeof config.recipient_email === "string" ? config.recipient_email : null;
    const validation = rawRecipients
      ? validateRecipients(rawRecipients)
      : { valid: false as const, error: "is not set" };
    if (!validation.valid) {
      return {
        sent: false,
        reason: "invalid_recipients",
        error: validation.error,
        new_conflicts: fresh.length,
      };
    }

    const items: ConflictAlertItem[] = fresh.map((c) => ({
      orderRef: c.targetRef ?? c.targetId,
      consigneeName: c.consigneeName,
      reasonLabel: decisionReasonLabel(c.skipReason),
    }));
    const model: ConflictAlertModel = {
      mode: input.mode,
      detectedAt: new Date().toISOString(),
      items,
    };

    const sent = await sendEmail({
      to: validation.emails,
      subject: buildConflictAlertSubject(model),
      html: renderConflictAlertHtml(model),
    });

    return {
      sent: true,
      message_id: sent.id,
      recipient: validation.emails.join(", "),
      new_conflicts: fresh.length,
      suppressed_as_repeat: input.conflicts.length - fresh.length,
    };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { sent: false, reason: "error", error: message, conflicts_found: input.conflicts.length };
  }
}
