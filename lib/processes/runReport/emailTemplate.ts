/**
 * Pure HTML-email rendering — no I/O. Data gathering lives in
 * queryReportData.ts; this only turns an already-assembled ReportModel into
 * a subject line and an HTML body.
 *
 * Email clients (Outlook especially) don't reliably support CSS variables,
 * flexbox, or grid, so this is deliberately table-based layout with inline
 * styles — not a port of the app's Tailwind classes. Colors are the same hex
 * values from tailwind.config.ts (forest/canopy/harvest/blaze/soil/bark/
 * stone/sand/parchment/cream/warmwhite) so the email reads as the same
 * product as the Hub, without pretending email HTML can use shadcn
 * components directly.
 */

export const COLOR = {
  forest: "#172E24",
  canopy: "#1A5C34",
  canopyLight: "#2D5E43",
  harvest: "#D4A017",
  blaze: "#C8302C",
  soil: "#1A1A18",
  bark: "#3D3B37",
  stone: "#6B6760",
  clay: "#9C9690",
  sand: "#D4CFC8",
  parchment: "#F0ECE4",
  cream: "#F8F5EF",
  warmwhite: "#FEFDFB",
} as const;

export interface RuleHealthIssue {
  customerLabel: string; // "COLME" or "Any customer"
  consignorCode: string;
  reason: string;
}

export interface NeedsAttentionItem {
  orderRef: string;
  consigneeName: string | null;
  reasonLabel: string;
  seenInRuns: number;
}

export interface AssignmentItem {
  orderRef: string;
  consigneeName: string | null;
  consignorCode: string;
  ruleLabel: string | null;
  at: string; // ISO
}

export interface FailureItem {
  orderRef: string;
  consigneeName: string | null;
  error: string;
  at: string; // ISO
}

export interface ReportModel {
  mode: "dry_run" | "apply";
  processEnabled: boolean;
  generatedAt: string; // ISO
  periodStart: string | null; // null = first-ever report
  periodEnd: string; // ISO
  latestRun: { startedAt: string; trigger: "cron" | "manual"; candidatesSeen: number } | null;
  ruleHealth: { validCount: number; totalCount: number; issues: RuleHealthIssue[] };
  // Failed writes are an engineering anomaly (the read-modify-write diff
  // assertion caught something unexpected, or the FreshTrack call itself
  // failed) — more urgent than a routine business exception, so it gets its
  // own top-billed section rather than being folded into needsAttention.
  failures: FailureItem[];
  needsAttention: NeedsAttentionItem[];
  assignments: AssignmentItem[]; // "applied" in apply mode, "proposed" in dry_run
  runsInPeriod: number;
  scheduleLabel: string; // e.g. "daily at 7am Brisbane time"
  hubUrl: string;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Brisbane",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });
}

export function buildReportSubject(model: ReportModel): string {
  if (!model.processEnabled) {
    return "Auto FT Consignor Update — paused";
  }
  if (model.failures.length > 0) {
    return `Auto FT Consignor Update — ${model.failures.length} write${model.failures.length === 1 ? "" : "s"} failed`;
  }
  if (model.ruleHealth.issues.length > 0) {
    return `Auto FT Consignor Update — ${model.ruleHealth.issues.length} rule needs attention`;
  }
  if (model.needsAttention.length > 0) {
    return `Auto FT Consignor Update — ${model.needsAttention.length} order${model.needsAttention.length === 1 ? "" : "s"} need${model.needsAttention.length === 1 ? "s" : ""} a decision`;
  }
  if (model.assignments.length > 0) {
    const verb = model.mode === "apply" ? "assigned" : "ready to assign";
    return `Auto FT Consignor Update — ${model.assignments.length} order${model.assignments.length === 1 ? "" : "s"} ${verb}`;
  }
  return "Auto FT Consignor Update — all clear";
}

function statPill(label: string, value: number, tone: "neutral" | "success" | "warning" | "danger"): string {
  const bg = { neutral: COLOR.cream, success: "#E8F1EC", warning: "#FBF1DA", danger: "#FAE7E6" }[tone];
  const fg = { neutral: COLOR.soil, success: COLOR.canopy, warning: "#8A6A10", danger: COLOR.blaze }[tone];
  return `
    <td style="padding:4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:10px;">
        <tr>
          <td style="padding:14px 12px;text-align:center;">
            <div style="font-size:22px;font-weight:600;color:${fg};line-height:1.2;font-family:Arial,Helvetica,sans-serif;">${value}</div>
            <div style="font-size:11px;color:${COLOR.stone};margin-top:2px;font-family:Arial,Helvetica,sans-serif;">${esc(label)}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

function sectionCard(title: string, accentColor: string, bodyHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:${COLOR.warmwhite};border:1px solid ${COLOR.sand};border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;border-left:3px solid ${accentColor};border-radius:12px;">
          <div style="font-size:14px;font-weight:600;color:${COLOR.soil};font-family:Arial,Helvetica,sans-serif;margin-bottom:10px;">${esc(title)}</div>
          ${bodyHtml}
        </td>
      </tr>
    </table>`;
}

function emptyState(text: string): string {
  return `<div style="font-size:13px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;">${esc(text)}</div>`;
}

export function renderReportHtml(model: ReportModel): string {
  const modeLabel = model.mode === "apply" ? "Live — writes to FreshTrack" : "Dry run — proposes only";
  const modePillBg = model.mode === "apply" ? COLOR.canopy : COLOR.harvest;

  const failuresBody =
    model.failures.length === 0
      ? emptyState("No writes failed in this period.")
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
        model.failures
          .map(
            (item) => `
          <tr>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;">
              <strong style="color:${COLOR.soil};">${esc(item.orderRef)}</strong>
              <span style="color:${COLOR.stone};"> · ${esc(item.consigneeName ?? "unknown customer")}</span><br/>
              <span style="color:${COLOR.blaze};font-family:monospace,Arial;font-size:12px;">${esc(item.error)}</span>
            </td>
          </tr>`
          )
          .join("") +
        `</table>`;

  const ruleHealthBody =
    model.ruleHealth.issues.length === 0
      ? emptyState(`All ${model.ruleHealth.totalCount} rules resolve to an active consignor.`)
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
        model.ruleHealth.issues
          .map(
            (issue) => `
          <tr>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;color:${COLOR.bark};font-family:Arial,Helvetica,sans-serif;">
              <strong style="color:${COLOR.soil};">${esc(issue.customerLabel)} → ${esc(issue.consignorCode)}</strong><br/>
              <span style="color:${COLOR.blaze};">${esc(issue.reason)}</span>
            </td>
          </tr>`
          )
          .join("") +
        `</table>`;

  const attentionBody =
    model.needsAttention.length === 0
      ? emptyState("No orders currently need a decision.")
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Order</td>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Customer</td>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Reason</td>
          </tr>` +
        model.needsAttention
          .map(
            (item) => `
          <tr>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:monospace,Arial;color:${COLOR.soil};vertical-align:top;">${esc(item.orderRef)}</td>
            <td style="padding:6px 8px;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.bark};vertical-align:top;">${esc(item.consigneeName ?? "—")}</td>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.blaze};vertical-align:top;">${esc(item.reasonLabel)}${item.seenInRuns > 1 ? ` <span style="color:${COLOR.stone};">(seen in ${item.seenInRuns} runs)</span>` : ""}</td>
          </tr>`
          )
          .join("") +
        `</table>`;

  const assignmentsVerb = model.mode === "apply" ? "Assigned to" : "Would assign to";
  const assignmentsBody =
    model.assignments.length === 0
      ? emptyState(
          model.mode === "apply"
            ? "No consignors were assigned in this period."
            : "No orders are currently ready to assign."
        )
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Order</td>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Customer</td>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">${esc(assignmentsVerb)}</td>
            <td style="font-size:11px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;padding-bottom:4px;">Via rule</td>
          </tr>` +
        model.assignments
          .map(
            (item) => `
          <tr>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:monospace,Arial;color:${COLOR.soil};vertical-align:top;">${esc(item.orderRef)}</td>
            <td style="padding:6px 8px;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.bark};vertical-align:top;">${esc(item.consigneeName ?? "—")}</td>
            <td style="padding:6px 8px;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.canopy};font-weight:600;vertical-align:top;">${esc(item.consignorCode)}</td>
            <td style="padding:6px 0;border-top:1px solid ${COLOR.parchment};font-size:12px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.stone};vertical-align:top;">${esc(item.ruleLabel ?? "—")}</td>
          </tr>`
          )
          .join("") +
        `</table>`;

  const periodLabel = model.periodStart
    ? `${fmtDateTime(model.periodStart)} – ${fmtDateTime(model.periodEnd)}`
    : `up to ${fmtDateTime(model.periodEnd)}`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COLOR.parchment};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.parchment};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
            <tr>
              <td style="background:${COLOR.forest};border-radius:12px 12px 0 0;padding:20px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:16px;font-weight:600;color:${COLOR.warmwhite};font-family:Arial,Helvetica,sans-serif;">
                      Auto FT Consignor Update
                    </td>
                    <td align="right">
                      <span style="display:inline-block;background:${modePillBg};color:${COLOR.forest};font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;">
                        ${esc(modeLabel)}
                      </span>
                    </td>
                  </tr>
                </table>
                <div style="font-size:12px;color:${COLOR.sand};margin-top:6px;font-family:Arial,Helvetica,sans-serif;">
                  ${esc(periodLabel)}
                </div>
              </td>
            </tr>

            ${
              !model.processEnabled
                ? `<tr><td style="background:#FAE7E6;border:1px solid ${COLOR.blaze};padding:12px 18px;font-size:13px;color:${COLOR.blaze};font-family:Arial,Helvetica,sans-serif;">
                    ⏸ This process is currently paused — no runs have happened since it was turned off.
                  </td></tr>`
                : ""
            }

            <tr>
              <td style="background:${COLOR.warmwhite};padding:16px 18px 4px;border-left:1px solid ${COLOR.sand};border-right:1px solid ${COLOR.sand};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${statPill("Orders seen", model.latestRun?.candidatesSeen ?? 0, "neutral")}
                    ${statPill(
                      model.mode === "apply" ? "Assigned" : "Ready to assign",
                      model.assignments.length,
                      "success"
                    )}
                    ${statPill("Failed writes", model.failures.length, model.failures.length > 0 ? "danger" : "neutral")}
                    ${statPill("Need a decision", model.needsAttention.length, model.needsAttention.length > 0 ? "warning" : "neutral")}
                    ${statPill("Rule issues", model.ruleHealth.issues.length, model.ruleHealth.issues.length > 0 ? "danger" : "neutral")}
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="background:${COLOR.warmwhite};padding:0 18px 16px;border-left:1px solid ${COLOR.sand};border-right:1px solid ${COLOR.sand};border-bottom:1px solid ${COLOR.sand};border-radius:0 0 12px 12px;">
                ${sectionCard("Failed writes", COLOR.blaze, failuresBody)}
                ${sectionCard("Rule health", COLOR.blaze, ruleHealthBody)}
                ${sectionCard("Needs a decision", COLOR.harvest, attentionBody)}
                ${sectionCard(model.mode === "apply" ? "Successful consignor posts" : "Ready to assign (dry run)", COLOR.canopy, assignmentsBody)}

                <div style="margin-top:16px;font-size:12px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;">
                  ${model.runsInPeriod} run${model.runsInPeriod === 1 ? "" : "s"} in this period ·
                  last run ${model.latestRun ? fmtDateTime(model.latestRun.startedAt) : "never"} ·
                  reports send ${esc(model.scheduleLabel)}
                </div>

                <div style="margin-top:14px;">
                  <a href="${esc(model.hubUrl)}" style="display:inline-block;background:${COLOR.canopy};color:${COLOR.warmwhite};text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;">
                    Open in the Hub →
                  </a>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 18px;text-align:center;">
                <span style="font-size:11px;color:${COLOR.clay};font-family:Arial,Helvetica,sans-serif;">
                  Generated ${fmtDate(model.generatedAt)} · Auto FT Consignor Update · Mackays Marketing Hub
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
