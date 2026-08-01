/**
 * Pure HTML rendering for the per-run conflict alert — no I/O. Deciding which
 * orders are new and actually sending live in conflictAlert.ts, mirroring the
 * emailTemplate/queryReportData split on the report side.
 *
 * This is the *exception* channel: it fires the moment an order is found that
 * the tool cannot assign because the rules don't give a single answer, and it
 * only ever mentions orders it hasn't already told you about. The hourly/4h/
 * daily summary remains the place where still-outstanding items are listed —
 * so this email is always "here is something new", never "here is the running
 * total".
 *
 * Deliberately shares COLOR/esc with the report template so both read as the
 * same product; same table-based, inline-styled constraints apply (Outlook).
 */
import { COLOR, esc } from "../runReport/emailTemplate";

export interface ConflictAlertItem {
  orderRef: string;
  consigneeName: string | null;
  reasonLabel: string;
}

export interface ConflictAlertModel {
  mode: "dry_run" | "apply";
  detectedAt: string; // ISO
  items: ConflictAlertItem[];
}

export function buildConflictAlertSubject(model: ConflictAlertModel): string {
  const n = model.items.length;
  return `Auto FT Consignor Update — action needed: ${n} order${n === 1 ? "" : "s"} blocked by a rule conflict`;
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

export function renderConflictAlertHtml(model: ConflictAlertModel): string {
  const n = model.items.length;
  const modeNote =
    model.mode === "apply"
      ? "Every other order in this run was assigned as normal — only these were left untouched."
      : "The tool is in dry-run mode, so nothing was written to FreshTrack in this run regardless.";

  const rows = model.items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.soil};font-weight:600;">${esc(item.orderRef)}</td>
          <td style="padding:10px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.bark};">${esc(item.consigneeName ?? "—")}</td>
          <td style="padding:10px 0;border-top:1px solid ${COLOR.parchment};font-size:13px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.blaze};text-align:right;">${esc(item.reasonLabel)}</td>
        </tr>`
    )
    .join("");

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.cream};padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
        <tr>
          <td style="padding-bottom:12px;">
            <div style="font-size:18px;font-weight:600;color:${COLOR.forest};font-family:Arial,Helvetica,sans-serif;">Auto FT Consignor Update</div>
            <div style="font-size:13px;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;margin-top:2px;">Conflict detected ${esc(fmtDateTime(model.detectedAt))} Brisbane time</div>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.warmwhite};border:1px solid ${COLOR.sand};border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;border-left:3px solid ${COLOR.blaze};border-radius:12px;">
                  <div style="font-size:15px;font-weight:600;color:${COLOR.blaze};font-family:Arial,Helvetica,sans-serif;">${n} order${n === 1 ? "" : "s"} could not be assigned</div>
                  <div style="font-size:13px;color:${COLOR.bark};font-family:Arial,Helvetica,sans-serif;margin-top:6px;line-height:1.5;">
                    The mapping rules don't give a single answer for ${n === 1 ? "this order" : "these orders"}, so the tool left ${n === 1 ? "it" : "them"} alone rather than guess. ${esc(modeNote)}
                  </div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                    <tr>
                      <td style="padding-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;">Order</td>
                      <td style="padding-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;">Customer</td>
                      <td style="padding-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.stone};font-family:Arial,Helvetica,sans-serif;text-align:right;">Why</td>
                    </tr>
                    ${rows}
                  </table>
                  <div style="font-size:13px;color:${COLOR.bark};font-family:Arial,Helvetica,sans-serif;margin-top:16px;line-height:1.5;">
                    Fix it either by adding or narrowing a rule under <strong>Mapping rules</strong>, or by setting the consignor by hand in FreshTrack. Until then ${n === 1 ? "it stays" : "they stay"} listed under &ldquo;needs a decision&rdquo; in the summary report.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding-top:14px;font-size:11px;color:${COLOR.clay};font-family:Arial,Helvetica,sans-serif;">
            You're getting this because a new conflict was found in a run. Repeat sightings of the same order are not re-sent — check the summary report for everything still outstanding.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
