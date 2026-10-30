/**
 * GET — the Marketer fill tab's headline: on/off and mode, the latest run's
 * counts, and who the fill covers RIGHT NOW (customer groups resolved live
 * against FreshTrack, with each customer's name), so the page shows what a
 * run would actually touch. Read-only; any Tools-access user.
 */
import { NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import { Q_ENTITIES_FOR_MARKETER_SCOPE, type RspScopeEntities } from "@/lib/freshtrack/queries";
import { MARKETER_PROCESS_KEY, readMarketerConfig } from "@/lib/processes/marketerFill/config";
import { resolveMarketerScope } from "@/lib/processes/marketerFill/scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [{ data: def }, { data: latestRun }] = await Promise.all([
    admin
      .from("process_definitions")
      .select("key, name, enabled, mode, config")
      .eq("key", MARKETER_PROCESS_KEY)
      .maybeSingle(),
    admin
      .from("process_runs")
      .select(
        "id, trigger, mode, status, started_at, completed_at, candidates_seen, actions_proposed, actions_applied, actions_skipped, actions_failed, error, payload"
      )
      .eq("process_key", MARKETER_PROCESS_KEY)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const cfg = readMarketerConfig(def?.config);
  let scope: {
    groups: Array<{ code: string; name: string; customerCount: number }>;
    customers: string[];
    marketer: { code: string; name: string };
  } | null = null;
  let scopeError: string | null = null;
  try {
    const res = await gqlQuery<RspScopeEntities>(Q_ENTITIES_FOR_MARKETER_SCOPE, { limit: 2000 });
    const resolved = resolveMarketerScope(res.entities, cfg.customer_group_codes, cfg.marketer_entity_code);
    if (resolved.ok) {
      scope = {
        groups: resolved.scope.groups,
        customers: Array.from(resolved.scope.consigneeNameById.values()).sort(),
        marketer: { code: resolved.scope.marketerCode, name: resolved.scope.marketerName },
      };
    } else {
      scopeError = resolved.error;
    }
  } catch (err) {
    scopeError = `Couldn't reach FreshTrack: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json({
    process: def ? { key: def.key, name: def.name, enabled: def.enabled, mode: def.mode } : null,
    latestRun: latestRun ?? null,
    scope,
    scopeError,
  });
}
