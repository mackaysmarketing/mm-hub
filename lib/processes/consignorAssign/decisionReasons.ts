/**
 * The skip reasons that mean "a human has to decide", shared by everything
 * that surfaces them: the run-report email, the Tools overview endpoint, and
 * the per-run conflict alert.
 *
 * Every other skip reason (no_consignee, guard failures,
 * already_assigned_by_other, the crop-resolution budget cap) is either
 * out-of-scope-for-now or a structural non-issue, not something to action.
 *
 * Previously duplicated in three places with a "mirrors the other one"
 * comment; centralised here so an alert can never disagree with the report
 * about what counts as a conflict.
 */

/** Plain string[] rather than a const tuple — PostgREST `.in()` wants a mutable array. */
export const DECISION_SKIP_REASONS: string[] = [
  "ambiguous_multi_crop",
  "no_rule_matched",
];

export const DECISION_REASON_LABELS: Record<string, string> = {
  ambiguous_multi_crop: "Mixed crops, different consignors",
  no_rule_matched: "No matching rule",
};

export function decisionReasonLabel(skipReason: string | null): string {
  return DECISION_REASON_LABELS[skipReason ?? ""] ?? skipReason ?? "Unknown reason";
}
