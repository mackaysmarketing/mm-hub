/**
 * "Auto FT Marketer Update" (process key marketer_auto_fill).
 *
 * Woolworths POs imported by hand from the web-forms XML land in FreshTrack
 * with a blank marketer at some DCs, and the Orders portal only shows orders
 * whose marketer is Mackays Marketing (or, with no marketer, whose consignor
 * is) — so those POs never reach it. This fills the BLANK marketer with
 * Mackays Marketing on open orders of every customer under Woolworths Head
 * Office. A marketer that is already set is never changed, so third-party
 * marketers' orders are untouched. Agreed with Gabby on 30 Oct 2026 as a
 * bridge until Woolworths EDI sends the marketer itself; switch it off then.
 *
 * Same shape as the consignor run: one process_actions row per candidate
 * (proposed, applied, skipped or failed), the same re-fetch / write /
 * re-fetch-and-diff write path, and dry run until an admin switches to apply.
 */
import "server-only";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FOR_MARKETER_SCOPE,
  Q_ORDER_STATES,
  Q_ORDERS_FOR_MARKETER_FILL,
  type RspScopeEntities,
  type RspOrderStates,
  type RspMarketerCandidates,
} from "@/lib/freshtrack/queries";
import { applyMarketer } from "../consignorAssign/apply";
import { logAction, type RunSummary, type ProcessMode } from "../runner";
import { readMarketerConfig } from "./config";
import { resolveMarketerScope, checkMarketerCandidate } from "./scope";

const ENTITY_FETCH_LIMIT = 2000;
const DISCOVERY_LIMIT = 2000;

type RunResult = Omit<RunSummary, "status"> & { partial?: boolean };

export async function runMarketerAutoFill(ctx: {
  runId: string;
  processKey: string;
  mode: ProcessMode;
  config: Record<string, unknown>;
}): Promise<RunResult> {
  const { runId, processKey, mode } = ctx;
  const cfg = readMarketerConfig(ctx.config);

  // Step 1: who is "Woolworths", and which marketer role to write — live,
  // every run, so a new DC or a renumbered role needs no config change. A
  // wrong code stops the run with a plain error (the runner records it as
  // failed) before a single order is fetched.
  const entitiesRes = await gqlQuery<RspScopeEntities>(Q_ENTITIES_FOR_MARKETER_SCOPE, {
    limit: ENTITY_FETCH_LIMIT,
  });
  const resolved = resolveMarketerScope(
    entitiesRes.entities,
    cfg.customer_group_codes,
    cfg.marketer_entity_code
  );
  if (!resolved.ok) throw new Error(resolved.error);
  const scope = resolved.scope;
  const inScope = new Set(scope.consigneeIds);

  const statesRes = await gqlQuery<RspOrderStates>(Q_ORDER_STATES);
  const stateCodeById = new Map(statesRes.orderStates.map((s) => [s.id, s.code]));
  const stateIds = statesRes.orderStates
    .filter((s) => cfg.assignable_state_codes.includes(s.code))
    .map((s) => s.id);

  const now = new Date();
  const deliveryStart = new Date(now.getTime() - cfg.discovery_lookback_days * 86_400_000);
  const deliveryEnd = new Date(now.getTime() + cfg.discovery_horizon_days * 86_400_000);
  const basePayload = {
    customer_groups: scope.groups,
    customers_in_scope: scope.consigneeIds.length,
    marketer: { code: scope.marketerCode, name: scope.marketerName },
    state_codes: cfg.assignable_state_codes,
    discovery_window: { start: deliveryStart.toISOString(), end: deliveryEnd.toISOString() },
  };

  const empty = { candidatesSeen: 0, actionsProposed: 0, actionsApplied: 0, actionsSkipped: 0, actionsFailed: 0 };
  if (stateIds.length === 0 || scope.consigneeIds.length === 0) {
    return {
      ...empty,
      partial: true,
      payload: {
        ...basePayload,
        warning:
          stateIds.length === 0
            ? "No order state is ticked, so nothing can be filled."
            : "The customer groups have no customers with a consignee role.",
      },
    };
  }

  // Step 2: discovery — open orders of in-scope customers only. Closed and
  // cancelled orders are never fetched, so they never log a skip.
  const discoveryRes = await gqlQuery<RspMarketerCandidates>(Q_ORDERS_FOR_MARKETER_FILL, {
    consigneeIds: scope.consigneeIds,
    stateIds,
    limit: DISCOVERY_LIMIT,
    deliveryStart: deliveryStart.toISOString(),
    deliveryEnd: deliveryEnd.toISOString(),
  });
  const discovered = discoveryRes.orders;
  const candidates = discovered.filter((o) => o.marketerId === null);

  let proposed = 0;
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of candidates) {
    const base = {
      runId,
      processKey,
      targetType: "freshtrack_order",
      targetId: order.id,
      targetRef: order.orderNo,
      consigneeName: order.consigneeId ? (scope.consigneeNameById.get(order.consigneeId) ?? null) : null,
      action: "set_marketer" as const,
      before: { marketer_ft_id: null },
    };

    // Defence in depth: FreshTrack already filtered on these, but a filter it
    // ignored must not turn into a write outside scope.
    const skipReason = checkMarketerCandidate(
      {
        marketerId: order.marketerId,
        consigneeId: order.consigneeId,
        isArchived: order.isArchived,
        stateCode: stateCodeById.get(order.stateId) ?? null,
      },
      inScope,
      cfg.assignable_state_codes
    );
    if (skipReason) {
      skipped++;
      await logAction({ ...base, status: "skipped", skipReason, after: {} });
      continue;
    }

    const after = { marketer_ft_id: scope.marketerRoleId, code: scope.marketerCode };
    proposed++;

    if (mode === "dry_run") {
      await logAction({ ...base, status: "proposed", after });
      continue;
    }

    const result = await applyMarketer(order.id, scope.marketerRoleId, (fresh) =>
      checkMarketerCandidate(
        {
          marketerId: null, // checked by applyMarketer itself
          consigneeId: fresh.consigneeId,
          isArchived: fresh.isArchived,
          stateCode: stateCodeById.get(fresh.stateId) ?? null,
        },
        inScope,
        cfg.assignable_state_codes
      )
    );
    if (result.outcome === "applied") {
      applied++;
      await logAction({ ...base, status: "applied", after });
    } else if (result.outcome === "already_assigned_by_other") {
      skipped++;
      await logAction({ ...base, status: "skipped", skipReason: "already_assigned_by_other", after: {} });
    } else if (result.outcome === "no_longer_eligible") {
      skipped++;
      await logAction({ ...base, status: "skipped", skipReason: "changed_since_discovery", after: { reason: result.reason } });
    } else {
      failed++;
      await logAction({ ...base, status: "failed", error: result.error, after: {} });
    }
  }

  return {
    candidatesSeen: candidates.length,
    actionsProposed: proposed,
    actionsApplied: applied,
    actionsSkipped: skipped,
    actionsFailed: failed,
    payload: {
      ...basePayload,
      orders_checked: discovered.length,
      // At the limit, some orders may not have been seen this run.
      discovery_limit_hit: discovered.length >= DISCOVERY_LIMIT,
    },
  };
}
