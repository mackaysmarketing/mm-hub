import { describe, it, expect } from "vitest";
import {
  resolvePeriodBoundary,
  buildReportModel,
  type RawReportData,
  type RuleLabelInfo,
} from "./reportModel";

function baseRaw(over: Partial<RawReportData> = {}): RawReportData {
  return {
    assignProcessEnabled: true,
    assignProcessMode: "dry_run",
    reportScheduleRaw: { frequency: "daily", at_hour_brisbane: 7 },
    latestRun: { trigger: "cron", startedAt: "2026-08-01T09:00:00.000Z", candidatesSeen: 4 },
    periodStart: "2026-07-31T21:00:00.000Z",
    periodEnd: "2026-08-01T21:00:00.000Z",
    ruleHealth: { validCount: 11, totalCount: 11, issues: [] },
    currentAttention: [],
    attentionHistory: [],
    latestProposed: [],
    appliedSincePeriod: [],
    failedSincePeriod: [],
    ruleLabelsById: new Map<string, RuleLabelInfo>(),
    runsInPeriod: 6,
    ...over,
  };
}

describe("resolvePeriodBoundary", () => {
  const now = new Date("2026-08-01T21:00:00.000Z");

  it("uses the last successful report's completed_at as both the model period start and the query boundary", () => {
    const result = resolvePeriodBoundary("2026-07-25T00:00:00.000Z", now);
    expect(result).toEqual({
      periodStart: "2026-07-25T00:00:00.000Z",
      queryBoundary: "2026-07-25T00:00:00.000Z",
    });
  });

  it("falls back to a default lookback and reports periodStart as null when the report has never sent", () => {
    const result = resolvePeriodBoundary(null, now, 7);
    expect(result.periodStart).toBeNull();
    expect(result.queryBoundary).toBe("2026-07-25T21:00:00.000Z"); // 7 days before `now`
  });

  it("honours a custom lookback window", () => {
    const result = resolvePeriodBoundary(null, now, 1);
    expect(result.queryBoundary).toBe("2026-07-31T21:00:00.000Z");
  });
});

describe("buildReportModel", () => {
  it("defaults an unknown/missing process mode to dry_run rather than throwing", () => {
    const model = buildReportModel(baseRaw({ assignProcessMode: null }));
    expect(model.mode).toBe("dry_run");
  });

  it("passes processEnabled and the state-snapshot fields straight through", () => {
    const model = buildReportModel(baseRaw({ assignProcessEnabled: false }));
    expect(model.processEnabled).toBe(false);
    expect(model.ruleHealth).toEqual({ validCount: 11, totalCount: 11, issues: [] });
    expect(model.runsInPeriod).toBe(6);
  });

  it("maps skip reasons to human labels, falling back to the raw code for an unrecognised one", () => {
    const model = buildReportModel(
      baseRaw({
        currentAttention: [
          { targetId: "t1", targetRef: "5024335", consigneeName: "Coles Eastern Creek", skipReason: "ambiguous_multi_crop" },
          { targetId: "t2", targetRef: "5024336", consigneeName: "ALDI Stapylton", skipReason: "no_rule_matched" },
          { targetId: "t3", targetRef: "5024337", consigneeName: null, skipReason: "some_future_reason" },
        ],
      })
    );
    expect(model.needsAttention.map((a) => a.reasonLabel)).toEqual([
      "Mixed crops, different consignors",
      "No matching rule",
      "some_future_reason",
    ]);
  });

  it("falls back to the target id as the order ref when target_ref is missing", () => {
    const model = buildReportModel(
      baseRaw({
        currentAttention: [
          { targetId: "internal-uuid", targetRef: null, consigneeName: null, skipReason: "no_rule_matched" },
        ],
      })
    );
    expect(model.needsAttention[0].orderRef).toBe("internal-uuid");
  });

  it("counts DISTINCT runs per target for the repeat-conflict indicator", () => {
    const model = buildReportModel(
      baseRaw({
        currentAttention: [
          { targetId: "t1", targetRef: "5024335", consigneeName: null, skipReason: "no_rule_matched" },
        ],
        attentionHistory: [
          { targetId: "t1", runId: "run-1" },
          { targetId: "t1", runId: "run-2" },
          { targetId: "t1", runId: "run-2" }, // duplicate run — must not double-count
          { targetId: "other-target", runId: "run-2" },
        ],
      })
    );
    expect(model.needsAttention[0].seenInRuns).toBe(2);
  });

  it("defaults seenInRuns to 1 when a current conflict has no matching history row", () => {
    const model = buildReportModel(
      baseRaw({
        currentAttention: [
          { targetId: "brand-new", targetRef: "5024999", consigneeName: null, skipReason: "no_rule_matched" },
        ],
        attentionHistory: [],
      })
    );
    expect(model.needsAttention[0].seenInRuns).toBe(1);
  });

  it("in dry_run mode, sources assignments from latestProposed and ignores appliedSincePeriod", () => {
    const model = buildReportModel(
      baseRaw({
        assignProcessMode: "dry_run",
        latestProposed: [
          { targetRef: "1", consigneeName: "A", consignorCode: "MMTRU", ruleId: null, createdAt: "2026-08-01T00:00:00Z" },
        ],
        appliedSincePeriod: [
          { targetRef: "2", consigneeName: "B", consignorCode: "SQBRL", ruleId: null, createdAt: "2026-08-01T00:00:00Z" },
        ],
      })
    );
    expect(model.assignments.map((a) => a.orderRef)).toEqual(["1"]);
  });

  it("in apply mode, sources assignments from appliedSincePeriod and ignores latestProposed", () => {
    const model = buildReportModel(
      baseRaw({
        assignProcessMode: "apply",
        latestProposed: [
          { targetRef: "1", consigneeName: "A", consignorCode: "MMTRU", ruleId: null, createdAt: "2026-08-01T00:00:00Z" },
        ],
        appliedSincePeriod: [
          { targetRef: "2", consigneeName: "B", consignorCode: "SQBRL", ruleId: null, createdAt: "2026-08-01T00:00:00Z" },
        ],
      })
    );
    expect(model.assignments.map((a) => a.orderRef)).toEqual(["2"]);
  });

  it("formats a rule label from the customer code and crop name when the rule is known", () => {
    const model = buildReportModel(
      baseRaw({
        assignProcessMode: "apply",
        appliedSincePeriod: [
          { targetRef: "1", consigneeName: "Coles Eastern Creek", consignorCode: "APPEC", ruleId: "rule-1", createdAt: "2026-08-01T00:00:00Z" },
        ],
        ruleLabelsById: new Map([["rule-1", { consigneeEntityCode: "COLEC", cropName: "Papaya" }]]),
      })
    );
    expect(model.assignments[0].ruleLabel).toBe("COLEC + Papaya");
  });

  it("labels a global (any-customer) rule and a crop-agnostic rule in plain English", () => {
    const model = buildReportModel(
      baseRaw({
        assignProcessMode: "apply",
        appliedSincePeriod: [
          { targetRef: "1", consigneeName: "Coles Melbourne", consignorCode: "SQBRL", ruleId: "global-passion", createdAt: "2026-08-01T00:00:00Z" },
          { targetRef: "2", consigneeName: "Coles Melbourne", consignorCode: "MMTRU", ruleId: "colme-default", createdAt: "2026-08-01T00:00:00Z" },
        ],
        ruleLabelsById: new Map([
          ["global-passion", { consigneeEntityCode: null, cropName: "Passionfruit" }],
          ["colme-default", { consigneeEntityCode: "COLME", cropName: null }],
        ]),
      })
    );
    expect(model.assignments[0].ruleLabel).toBe("Any customer + Passionfruit");
    expect(model.assignments[1].ruleLabel).toBe("COLME + any crop");
  });

  it("leaves ruleLabel null when the rule id doesn't resolve to a known rule", () => {
    const model = buildReportModel(
      baseRaw({
        assignProcessMode: "apply",
        appliedSincePeriod: [
          { targetRef: "1", consigneeName: null, consignorCode: "MMTRU", ruleId: "deleted-rule", createdAt: "2026-08-01T00:00:00Z" },
        ],
        ruleLabelsById: new Map(),
      })
    );
    expect(model.assignments[0].ruleLabel).toBeNull();
  });

  it("maps failures with a fallback message when error text is missing", () => {
    const model = buildReportModel(
      baseRaw({
        failedSincePeriod: [
          { targetRef: "5024318", consigneeName: "Coles Melbourne", error: "post-write diff mismatch", createdAt: "2026-08-01T00:00:00Z" },
          { targetRef: "5024319", consigneeName: null, error: null, createdAt: "2026-08-01T00:00:00Z" },
        ],
      })
    );
    expect(model.failures[0].error).toBe("post-write diff mismatch");
    expect(model.failures[1].error).toBe("Unknown error");
  });

  it("describes the schedule in plain English from the report's own config", () => {
    const model = buildReportModel(
      baseRaw({ reportScheduleRaw: { frequency: "daily", at_hour_brisbane: 7 } })
    );
    expect(model.scheduleLabel).toBe("daily at 7am Brisbane time");
  });

  it("falls back to a generic schedule label when the config is missing or malformed", () => {
    expect(buildReportModel(baseRaw({ reportScheduleRaw: null })).scheduleLabel).toBe(
      "on its configured schedule"
    );
    expect(buildReportModel(baseRaw({ reportScheduleRaw: { frequency: "weekly" } })).scheduleLabel).toBe(
      "on its configured schedule"
    );
  });

  it("uses the provided hubUrl, defaulting to the real Hub tool page", () => {
    expect(buildReportModel(baseRaw())).toMatchObject({
      hubUrl: "https://hub.mackaysmarketing.com.au/tools/consignor-auto-assign",
    });
    expect(buildReportModel(baseRaw(), "https://example.test/x")).toMatchObject({
      hubUrl: "https://example.test/x",
    });
  });
});
