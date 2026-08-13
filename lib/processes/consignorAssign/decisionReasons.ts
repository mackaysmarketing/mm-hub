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
  "unmapped_crop",
  "multiple_not_configured",
  "no_rule_matched",
  // Retired by Stage A of the MULTIPLE work: an order whose crops resolve to
  // different consignors now takes the MULTIPLE header instead of being
  // skipped. Kept in the list so the ~47 historical rows still surface and
  // still render a label rather than a raw slug.
  "ambiguous_multi_crop",
];

export const DECISION_REASON_LABELS: Record<string, string> = {
  unmapped_crop: "Crop on the order has no rule",
  multiple_not_configured: "Different consignors, MULTIPLE not configured",
  no_rule_matched: "No matching rule",
  ambiguous_multi_crop: "Mixed crops, different consignors (pre-MULTIPLE)",
};

export function decisionReasonLabel(skipReason: string | null): string {
  return DECISION_REASON_LABELS[skipReason ?? ""] ?? skipReason ?? "Unknown reason";
}
