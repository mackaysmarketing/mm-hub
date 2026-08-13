/**
 * Orchestration for "Auto FT Consignor Update". See design doc §6.2 for the
 * numbered run sequence this implements.
 *
 * Every candidate produces exactly ONE process_actions row — proposed,
 * applied, skipped (with a reason), or failed — so the activity log and the
 * "needs a decision" view are both just filtered reads of that one table,
 * never a separately-tracked list.
 */
import "server-only";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDERS_BY_CONSIGNEES,
  Q_ORDER_VERSIONS_BY_ORDER,
  Q_ORDER_ITEMS_BY_ORDER_VERSION,
  Q_ORDER_STATES,
  Q_PRODUCTS_ALL,
  type RspOrderCandidates,
  type RspOrderVersions,
  type RspOrderItems,
  type RspOrderStates,
  type RspProducts,
  type FTProductMini,
} from "@/lib/freshtrack/queries";
import { resolveRules } from "./resolveRules";
import { needsCropResolution, matchOrder } from "./matchOrder";
import { checkOrderGuards } from "./guards";
import { applyConsignor } from "./apply";
import { maybeSendConflictAlert, type ConflictCandidate } from "./conflictAlert";
import { logAction, type RunSummary, type ProcessMode } from "../runner";

const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_HORIZON_DAYS = 45;
const DISCOVERY_LIMIT = 1000;
// Defensive cap on the expensive crop-resolution path (2 extra calls each) —
// only ever paid by COLEC-like crop-specific customers, whose real volume is
// a handful a day, so this should never bind in practice.
const MAX_CROP_RESOLUTIONS_PER_RUN = 200;
/** Entity code of the MULTIPLE consignor, for the activity log and alerts. */
const MULTIPLE_CONSIGNOR_CODE = "MULTI";

type RunResult = Omit<RunSummary, "status"> & { partial?: boolean };

export async function runConsignorAutoAssign(ctx: {
  runId: string;
  processKey: string;
  mode: ProcessMode;
  config: Record<string, unknown>;
}): Promise<RunResult> {
  const { runId, processKey, mode, config } = ctx;

  const assignableStateCodes = Array.isArray(config.assignable_state_codes)
    ? (config.assignable_state_codes as string[])
    : ["OR", "FORD", "Default"];
  const lookbackDays =
    typeof config.discovery_lookback_days === "number"
      ? config.discovery_lookback_days
      : DEFAULT_LOOKBACK_DAYS;
  const horizonDays =
    typeof config.discovery_horizon_days === "number"
      ? config.discovery_horizon_days
      : DEFAULT_HORIZON_DAYS;
  // The FreshTrack consignor ROLE id of the MULTIPLE entity (code MULTI) — not
  // its entity id; the two differ, and the rules table stores role ids too.
  // Absent means Stage A is off and a multi-consignor order is skipped exactly
  // as it was before, so this stays inert until an admin sets it.
  const multipleConsignorFtId =
    typeof config.multiple_consignor_ft_id === "string" &&
    config.multiple_consignor_ft_id.length > 0
      ? config.multiple_consignor_ft_id
      : null;

  // Step 2: load + validate rules against LIVE FreshTrack.
  const { validRules, invalidRules, consigneeNameById } = await resolveRules();
  const partial = invalidRules.length > 0;
  const invalidRulesPayload = invalidRules.map((r) => ({
    code: r.rule.consignee_entity_code,
    reason: r.reason,
  }));

  if (validRules.length === 0) {
    return {
      candidatesSeen: 0,
      actionsProposed: 0,
      actionsApplied: 0,
      actionsSkipped: 0,
      actionsFailed: 0,
      partial,
      payload: { invalid_rules: invalidRulesPayload },
    };
  }

  const statesRes = await gqlQuery<RspOrderStates>(Q_ORDER_STATES);
  const stateCodeById = new Map(statesRes.orderStates.map((s) => [s.id, s.code]));

  const now = new Date();
  const deliveryStart = new Date(now.getTime() - lookbackDays * 86_400_000);
  const deliveryEnd = new Date(now.getTime() + horizonDays * 86_400_000);

  // Step 3: discovery — live FreshTrack, scoped to consignees with an active
  // rule, never ft_orders (design doc §4 — decouples this process's freshness
  // from orderSync's once-nightly cadence).
  //
  // IMPORTANT (migration 00018): a global crop rule has consigneeFreshtrackId
  // === null and contributes NO new consignee to this list — it only changes
  // the OUTCOME for crops present on orders belonging to customers who are
  // discovered via some OTHER (non-null-consignee) rule. A customer with
  // literally no rule of their own still won't be found here, even though a
  // global rule would apply to them once discovered. Filter nulls out before
  // they ever reach filterConsigneeIds, which expects real UUIDs.
  const consigneeIds = Array.from(
    new Set(
      validRules
        .map((r) => r.consigneeFreshtrackId)
        .filter((id): id is string => id !== null)
    )
  );
  if (consigneeIds.length === 0) {
    // Only global rules are active — nothing drives discovery. Surface this
    // clearly rather than silently discovering zero candidates every run.
    return {
      candidatesSeen: 0,
      actionsProposed: 0,
      actionsApplied: 0,
      actionsSkipped: 0,
      actionsFailed: 0,
      partial: true,
      payload: {
        invalid_rules: invalidRulesPayload,
        warning:
          "Only global (any-customer) rules are active — none of them drive discovery on their own. Add at least one customer-specific rule so orders are found at all.",
      },
    };
  }
  const discoveryRes = await gqlQuery<RspOrderCandidates>(Q_ORDERS_BY_CONSIGNEES, {
    consigneeIds,
    limit: DISCOVERY_LIMIT,
    deliveryStart: deliveryStart.toISOString(),
    deliveryEnd: deliveryEnd.toISOString(),
  });
  const candidates = discoveryRes.orders.filter((o) => o.consignorId === null);

  let proposed = 0;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  let multipleAssigned = 0;
  let cropResolutionsUsed = 0;
  let productCache: Map<string, FTProductMini> | null = null;
  // Orders this run could not assign because the rules gave no single answer.
  // Collected here rather than re-queried from process_actions afterwards —
  // everything needed is already in hand at the point we log the skip.
  const conflicts: ConflictCandidate[] = [];

  for (const candidate of candidates) {
    const base = {
      runId,
      processKey,
      targetType: "freshtrack_order",
      targetId: candidate.id,
      targetRef: candidate.orderNo,
      consigneeName: candidate.consigneeId
        ? (consigneeNameById.get(candidate.consigneeId) ?? null)
        : null,
      action: "set_consignor" as const,
      before: { consignor_ft_id: null },
    };

    if (!candidate.consigneeId) {
      skipped++;
      await logAction({ ...base, status: "skipped", skipReason: "no_consignee", after: {} });
      continue;
    }

    // Step 4b: cheap guards first — no point paying for crop resolution on an
    // order we're going to skip anyway.
    const guardReason = checkOrderGuards(
      {
        isArchived: candidate.isArchived,
        stateCode: stateCodeById.get(candidate.stateId) ?? null,
        actualPickupOn: candidate.actualPickupOn,
        actualDeliveryOn: candidate.actualDeliveryOn,
      },
      assignableStateCodes
    );
    if (guardReason) {
      skipped++;
      await logAction({ ...base, status: "skipped", skipReason: guardReason, after: {} });
      continue;
    }

    // Step 4a: crop resolution, lazy — only when it could actually affect the
    // outcome (a customer-specific crop rule, OR any global crop rule at all
    // — migration 00018). Customers untouched by either never pay these 2
    // extra calls.
    let cropIds: string[] | null = null;
    if (needsCropResolution(validRules, candidate.consigneeId)) {
      if (cropResolutionsUsed >= MAX_CROP_RESOLUTIONS_PER_RUN) {
        skipped++;
        await logAction({
          ...base,
          status: "skipped",
          skipReason: "crop_resolution_budget_exceeded",
          after: {},
        });
        continue;
      }
      cropResolutionsUsed++;
      const cache: { products: Map<string, FTProductMini> | null } = {
        products: productCache,
      };
      cropIds = await resolveCropIds(candidate.id, cache);
      productCache = cache.products;
    }

    const match = matchOrder(validRules, candidate.consigneeId, cropIds);

    if (match.kind === "no_rule") {
      skipped++;
      await logAction({
        ...base,
        status: "skipped",
        skipReason: "no_rule_matched",
        after: {},
      });
      conflicts.push({
        targetId: base.targetId,
        targetRef: base.targetRef,
        consigneeName: base.consigneeName,
        skipReason: "no_rule_matched",
      });
      continue;
    }
    if (match.kind === "unmapped_crop") {
      // A crop on this order has NO rule, so its consignor is unknown. That is
      // not a MULTIPLE — MULTIPLE asserts we know them all — and it stays a
      // human decision exactly as before.
      skipped++;
      await logAction({
        ...base,
        status: "skipped",
        skipReason: "unmapped_crop",
        after: { matched_rule_ids: match.matchedRuleIds },
      });
      conflicts.push({
        targetId: base.targetId,
        targetRef: base.targetRef,
        consigneeName: base.consigneeName,
        skipReason: "unmapped_crop",
      });
      continue;
    }
    if (match.kind === "multiple" && !multipleConsignorFtId) {
      // Unconfigured falls back to the pre-Stage-A behaviour rather than
      // picking one of the candidates.
      skipped++;
      await logAction({
        ...base,
        status: "skipped",
        skipReason: "multiple_not_configured",
        after: {
          candidate_rule_ids: match.candidateRuleIds,
          consignor_codes: match.consignorEntityCodes,
        },
      });
      conflicts.push({
        targetId: base.targetId,
        targetRef: base.targetRef,
        consigneeName: base.consigneeName,
        skipReason: "multiple_not_configured",
      });
      continue;
    }

    // Either one rule matched, or every crop resolved to a DIFFERENT consignor
    // and the header becomes MULTIPLE. Both write one consignor to the order;
    // only the value and the provenance differ.
    const isMultiple = match.kind === "multiple";
    const targetConsignorId = isMultiple
      ? multipleConsignorFtId!
      : match.rule.consignorFreshtrackId;
    const ruleId = isMultiple ? null : match.rule.id;
    const after = isMultiple
      ? {
          consignor_ft_id: targetConsignorId,
          code: MULTIPLE_CONSIGNOR_CODE,
          reason: "multiple",
          candidate_rule_ids: match.candidateRuleIds,
          consignor_codes: match.consignorEntityCodes,
        }
      : {
          consignor_ft_id: targetConsignorId,
          code: match.rule.consignorEntityCode,
        };

    proposed++;
    if (isMultiple) multipleAssigned++;

    if (mode === "dry_run") {
      await logAction({
        ...base,
        status: "proposed",
        ruleId,
        after,
      });
      continue;
    }

    // Step 5: apply — live read-modify-write + post-write diff.
    const result = await applyConsignor(candidate.id, targetConsignorId);
    if (result.outcome === "applied") {
      applied++;
      await logAction({ ...base, status: "applied", ruleId, after });
    } else if (result.outcome === "already_assigned_by_other") {
      skipped++;
      await logAction({
        ...base,
        status: "skipped",
        skipReason: "already_assigned_by_other",
        ruleId,
        after: {},
      });
    } else {
      failed++;
      await logAction({
        ...base,
        status: "failed",
        error: result.error,
        ruleId,
        after: {},
      });
    }
  }

  // Runs last, and cannot throw — a Resend outage must not turn a run that
  // wrote to FreshTrack into a failed one. Outcome goes in the payload.
  const conflictAlert = await maybeSendConflictAlert({ runId, mode, conflicts });

  return {
    candidatesSeen: candidates.length,
    actionsProposed: proposed,
    actionsApplied: applied,
    actionsSkipped: skipped,
    actionsFailed: failed,
    partial,
    payload: {
      rules_validated: validRules.length,
      rules_invalid: invalidRules.length,
      invalid_rules: invalidRulesPayload,
      crop_resolutions_used: cropResolutionsUsed,
      // Orders whose crops resolved to more than one consignor and so took the
      // MULTIPLE header. Their LOADS still need per-crop consignors set by
      // hand — Stage B is not built — so this count is the "how much manual
      // load work did today create" signal.
      multiple_assigned: multipleAssigned,
      multiple_consignor_configured: multipleConsignorFtId !== null,
      discovery_window: {
        start: deliveryStart.toISOString(),
        end: deliveryEnd.toISOString(),
      },
      ...(conflictAlert ? { conflict_alert: conflictAlert } : {}),
    },
  };
}

async function resolveCropIds(
  orderId: string,
  cache: { products: Map<string, FTProductMini> | null }
): Promise<string[]> {
  const vRes = await gqlQuery<RspOrderVersions>(Q_ORDER_VERSIONS_BY_ORDER, { orderId });
  if (vRes.orderVersions.length === 0) return [];
  const latest = vRes.orderVersions.reduce((a, b) => (b.versionNo > a.versionNo ? b : a));

  const iRes = await gqlQuery<RspOrderItems>(Q_ORDER_ITEMS_BY_ORDER_VERSION, {
    orderVersionId: latest.id,
  });
  if (iRes.orderItems.length === 0) return [];

  if (!cache.products) {
    const pRes = await gqlQuery<RspProducts>(Q_PRODUCTS_ALL);
    cache.products = new Map(pRes.products.map((p) => [p.id, p]));
  }

  const cropIds = new Set<string>();
  for (const item of iRes.orderItems) {
    if (!item.productId) continue;
    const product = cache.products.get(item.productId);
    if (product?.cropId) cropIds.add(product.cropId);
  }
  return Array.from(cropIds);
}
