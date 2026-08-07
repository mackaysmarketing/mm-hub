/**
 * GET — headline stats for the Overview tab: latest run's counts, live rule
 * health, and the small "needs a decision" list, all in one call.
 *
 * Read access: any user with "Tools" menu access (admin/staff — not
 * grower/grower_admin). Mutations elsewhere in this feature are hub_admin
 * only; this endpoint is read-only.
 */
import { NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRules } from "@/lib/processes/consignorAssign/resolveRules";
import { DECISION_SKIP_REASONS } from "@/lib/processes/consignorAssign/decisionReasons";

export const dynamic = "force-dynamic";

const PROCESS_KEY = "consignor_auto_assign";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [{ data: def }, { data: latestRun }, ruleValidation] = await Promise.all([
    admin
      .from("process_definitions")
      .select("key, name, enabled, mode, config")
      .eq("key", PROCESS_KEY)
      .maybeSingle(),
    admin
      .from("process_runs")
      .select(
        "id, trigger, mode, status, started_at, completed_at, candidates_seen, actions_proposed, actions_applied, actions_skipped, actions_failed, error"
      )
      .eq("process_key", PROCESS_KEY)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    resolveRules().catch((err) => ({
      validRules: [],
      invalidRules: [],
      error: err instanceof Error ? err.message : String(err),
    })),
  ]);

  let needsDecision: unknown[] = [];
  if (latestRun) {
    const { data } = await admin
      .from("process_actions")
      .select("id, target_ref, consignee_name, skip_reason, created_at")
      .eq("run_id", latestRun.id)
      .in("skip_reason", DECISION_SKIP_REASONS)
      .order("created_at", { ascending: false })
      .limit(20);
    needsDecision = data ?? [];
  }

  return NextResponse.json({
    process: def ?? null,
    latestRun: latestRun ?? null,
    ruleHealth: {
      validCount: ruleValidation.validRules?.length ?? 0,
      invalidRules: ruleValidation.invalidRules ?? [],
      error: "error" in ruleValidation ? ruleValidation.error : null,
    },
    needsDecision,
  });
}
