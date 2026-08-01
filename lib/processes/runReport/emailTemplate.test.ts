import { describe, it, expect } from "vitest";
import { buildReportSubject, renderReportHtml, type ReportModel } from "./emailTemplate";

function baseModel(over: Partial<ReportModel> = {}): ReportModel {
  return {
    mode: "dry_run",
    processEnabled: true,
    generatedAt: "2026-08-01T21:00:00.000Z",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-01T21:00:00.000Z",
    latestRun: { startedAt: "2026-08-01T09:00:11.000Z", trigger: "cron", candidatesSeen: 4 },
    ruleHealth: { validCount: 11, totalCount: 11, issues: [] },
    failures: [],
    needsAttention: [],
    assignments: [],
    runsInPeriod: 21,
    scheduleLabel: "daily at 7am Brisbane time",
    hubUrl: "https://hub.mackaysmarketing.com.au/tools/consignor-auto-assign",
    ...over,
  };
}

describe("buildReportSubject", () => {
  it("leads with paused if the process is disabled, regardless of anything else", () => {
    const model = baseModel({
      processEnabled: false,
      ruleHealth: { validCount: 10, totalCount: 11, issues: [{ customerLabel: "x", consignorCode: "y", reason: "z" }] },
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — paused");
  });

  it("leads with paused even when failures exist — pausing is the dominant fact once it's happened", () => {
    const model = baseModel({
      processEnabled: false,
      failures: [{ orderRef: "1", consigneeName: null, error: "x", at: "2026-08-01T00:00:00Z" }],
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — paused");
  });

  it("leads with failed writes over rule issues — an engineering anomaly outranks a config problem", () => {
    const model = baseModel({
      failures: [
        {
          orderRef: "5024318",
          consigneeName: "Coles Melbourne",
          error: "post-write diff mismatch",
          at: "2026-08-01T09:00:00Z",
        },
      ],
      ruleHealth: { validCount: 10, totalCount: 11, issues: [{ customerLabel: "Any customer", consignorCode: "SQBRL", reason: "not found" }] },
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — 1 write failed");
  });

  it("pluralises failed writes correctly", () => {
    const model = baseModel({
      failures: [
        { orderRef: "1", consigneeName: null, error: "x", at: "2026-08-01T00:00:00Z" },
        { orderRef: "2", consigneeName: null, error: "x", at: "2026-08-01T00:00:00Z" },
      ],
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — 2 writes failed");
  });

  it("leads with rule issues over order-level conflicts — a broken rule is more severe", () => {
    const model = baseModel({
      ruleHealth: { validCount: 10, totalCount: 11, issues: [{ customerLabel: "Any customer", consignorCode: "SQBRL", reason: "not found" }] },
      needsAttention: [{ orderRef: "5024335", consigneeName: "Coles Eastern Creek", reasonLabel: "Mixed crops", seenInRuns: 3 }],
    });
    expect(buildReportSubject(model)).toContain("rule needs attention");
  });

  it("mentions decisions needed when there are conflicts but no rule issues", () => {
    const model = baseModel({
      needsAttention: [{ orderRef: "5024335", consigneeName: null, reasonLabel: "Mixed crops", seenInRuns: 1 }],
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — 1 order needs a decision");
  });

  it("pluralises correctly for multiple conflicts", () => {
    const model = baseModel({
      needsAttention: [
        { orderRef: "1", consigneeName: null, reasonLabel: "x", seenInRuns: 1 },
        { orderRef: "2", consigneeName: null, reasonLabel: "x", seenInRuns: 1 },
      ],
    });
    expect(buildReportSubject(model)).toBe("Auto FT Consignor Update — 2 orders need a decision");
  });

  it("distinguishes 'assigned' (apply mode) from 'ready to assign' (dry run) when nothing else is wrong", () => {
    const dryRun = baseModel({
      assignments: [{ orderRef: "1", consigneeName: null, consignorCode: "MMTRU", ruleLabel: null, at: "2026-08-01T00:00:00Z" }],
    });
    expect(buildReportSubject(dryRun)).toContain("ready to assign");

    const apply = baseModel({
      mode: "apply",
      assignments: [{ orderRef: "1", consigneeName: null, consignorCode: "MMTRU", ruleLabel: null, at: "2026-08-01T00:00:00Z" }],
    });
    expect(buildReportSubject(apply)).toContain("assigned");
    expect(buildReportSubject(apply)).not.toContain("ready to assign");
  });

  it("says all clear when there is genuinely nothing to report", () => {
    expect(buildReportSubject(baseModel())).toBe("Auto FT Consignor Update — all clear");
  });
});

describe("renderReportHtml", () => {
  it("escapes HTML in user-controlled text so a customer/order name can't inject markup", () => {
    const model = baseModel({
      needsAttention: [
        {
          orderRef: "<script>alert(1)</script>",
          consigneeName: "Coles <b>Melbourne</b>",
          reasonLabel: "x",
          seenInRuns: 1,
        },
      ],
    });
    const html = renderReportHtml(model);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Coles <b>Melbourne</b>");
  });

  it("escapes HTML in the failure error message and customer name too", () => {
    const html = renderReportHtml(
      baseModel({
        failures: [
          {
            orderRef: "5024318",
            consigneeName: "Coles <b>Melbourne</b>",
            error: "<script>alert(1)</script>",
            at: "2026-08-01T00:00:00Z",
          },
        ],
      })
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Coles <b>Melbourne</b>");
  });

  it("renders the failed-writes section with order, customer, and error detail", () => {
    const html = renderReportHtml(
      baseModel({
        failures: [
          {
            orderRef: "5024318",
            consigneeName: "Coles Melbourne",
            error: "post-write diff mismatch: consignorId still null",
            at: "2026-08-01T09:00:00Z",
          },
        ],
      })
    );
    expect(html).toContain("Failed writes");
    expect(html).toContain("5024318");
    expect(html).toContain("Coles Melbourne");
    expect(html).toContain("post-write diff mismatch: consignorId still null");
  });

  it("labels the assignments section and verb correctly per mode", () => {
    const dryRunHtml = renderReportHtml(
      baseModel({
        assignments: [{ orderRef: "5024318", consigneeName: "Coles Melbourne", consignorCode: "MMTRU", ruleLabel: null, at: "2026-08-01T00:00:00Z" }],
      })
    );
    expect(dryRunHtml).toContain("Ready to assign (dry run)");
    expect(dryRunHtml).toContain("Would assign to");

    const applyHtml = renderReportHtml(
      baseModel({
        mode: "apply",
        assignments: [{ orderRef: "5024318", consigneeName: "Coles Melbourne", consignorCode: "MMTRU", ruleLabel: null, at: "2026-08-01T00:00:00Z" }],
      })
    );
    expect(applyHtml).toContain("Successful consignor posts");
    expect(applyHtml).toContain("Assigned to");
    expect(applyHtml).not.toContain("dry run");
  });

  it("shows which rule matched when present, and a dash when it's not known", () => {
    const html = renderReportHtml(
      baseModel({
        assignments: [
          { orderRef: "1", consigneeName: "Coles Eastern Creek", consignorCode: "SQBRL", ruleLabel: "Any customer + Passionfruit", at: "2026-08-01T00:00:00Z" },
          { orderRef: "2", consigneeName: "Coles Melbourne", consignorCode: "MMTRU", ruleLabel: null, at: "2026-08-01T00:00:00Z" },
        ],
      })
    );
    expect(html).toContain("Any customer + Passionfruit");
    expect(html).toContain("Via rule");
  });

  it("shows a clear paused banner when the process is disabled", () => {
    const html = renderReportHtml(baseModel({ processEnabled: false }));
    expect(html).toContain("currently paused");
  });

  it("omits the paused banner when enabled", () => {
    const html = renderReportHtml(baseModel({ processEnabled: true }));
    expect(html).not.toContain("currently paused");
  });

  it("shows a reassuring empty state per section rather than a blank gap", () => {
    const html = renderReportHtml(baseModel());
    expect(html).toContain("All 11 rules resolve to an active consignor");
    expect(html).toContain("No orders currently need a decision");
    expect(html).toContain("No orders are currently ready to assign");
  });

  it("surfaces a repeat-conflict count when an order has been flagged across multiple runs", () => {
    const html = renderReportHtml(
      baseModel({
        needsAttention: [
          { orderRef: "5024335", consigneeName: "Coles Eastern Creek", reasonLabel: "Mixed crops", seenInRuns: 18 },
        ],
      })
    );
    expect(html).toContain("seen in 18 runs");
  });

  it("does not show a repeat count for a conflict seen only once", () => {
    const html = renderReportHtml(
      baseModel({
        needsAttention: [{ orderRef: "5024335", consigneeName: null, reasonLabel: "Mixed crops", seenInRuns: 1 }],
      })
    );
    expect(html).not.toContain("seen in 1 run");
  });

  it("links to the provided hub URL", () => {
    const html = renderReportHtml(baseModel());
    expect(html).toContain('href="https://hub.mackaysmarketing.com.au/tools/consignor-auto-assign"');
  });

  it("renders valid-looking HTML with a doctype and closing tags", () => {
    const html = renderReportHtml(baseModel());
    expect(html.trim().startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });
});
