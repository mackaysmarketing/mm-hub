/**
 * Pure scope logic for the marketer fill: which customers count as
 * "Woolworths", which marketer role to write, and whether one order may be
 * filled. No I/O — index.ts fetches the live entity tree and passes it in.
 */

/** The slice of a live FreshTrack entity the scope needs. */
export interface ScopeEntity {
  id: string;
  code: string;
  orgName: string;
  parentId: string | null;
  parent: { id: string; code: string } | null;
  consigneeId: string | null;
  marketerId: string | null;
  isMarketerActive: boolean;
}

export interface MarketerScope {
  /** Consignee ROLE ids in scope: each group's own, plus every child's. */
  consigneeIds: string[];
  consigneeNameById: Map<string, string>;
  marketerRoleId: string;
  marketerCode: string;
  marketerName: string;
  groups: Array<{ code: string; name: string; customerCount: number }>;
}

const norm = (code: string) => code.trim().toUpperCase();

export function resolveMarketerScope(
  entities: ScopeEntity[],
  groupCodes: string[],
  marketerCode: string
): { ok: true; scope: MarketerScope } | { ok: false; error: string } {
  const codes = Array.from(new Set(groupCodes.map(norm).filter(Boolean)));
  if (codes.length === 0) {
    return { ok: false, error: "No customer group is set — nothing to fill." };
  }

  const byCode = new Map(entities.map((e) => [norm(e.code), e]));

  const marketer = byCode.get(norm(marketerCode));
  if (!marketer) {
    return { ok: false, error: `Marketer ${norm(marketerCode)} was not found in FreshTrack.` };
  }
  if (!marketer.marketerId || !marketer.isMarketerActive) {
    return { ok: false, error: `${norm(marketerCode)} is not an active marketer in FreshTrack.` };
  }

  const consigneeNameById = new Map<string, string>();
  const groups: MarketerScope["groups"] = [];
  for (const code of codes) {
    const group = byCode.get(code);
    if (!group) {
      return { ok: false, error: `Customer group ${code} was not found in FreshTrack.` };
    }
    // The group itself (orders can be placed on the head office) and every
    // direct child with a consignee role. Matched on the parent's id, with the
    // code as a fallback, so a renamed code cannot silently empty the scope.
    const members = entities.filter(
      (e) =>
        e.consigneeId &&
        (e.id === group.id || e.parentId === group.id || (e.parent && norm(e.parent.code) === code))
    );
    for (const m of members) consigneeNameById.set(m.consigneeId!, m.orgName || m.code);
    groups.push({ code, name: group.orgName || group.code, customerCount: members.length });
  }

  return {
    ok: true,
    scope: {
      consigneeIds: Array.from(consigneeNameById.keys()),
      consigneeNameById,
      marketerRoleId: marketer.marketerId,
      marketerCode: norm(marketerCode),
      marketerName: marketer.orgName || marketer.code,
      groups,
    },
  };
}

export type MarketerSkipReason =
  | "marketer_already_set"
  | "no_consignee"
  | "out_of_scope_customer"
  | "archived"
  | "state_not_assignable";

export interface MarketerCandidateInput {
  marketerId: string | null;
  consigneeId: string | null;
  isArchived: boolean;
  stateCode: string | null;
}

/**
 * null = fill it. Unlike the consignor guards there is deliberately NO
 * "already picked up or delivered" check: a delivered Woolworths order with a
 * blank marketer is exactly the backlog this exists to clear.
 */
export function checkMarketerCandidate(
  order: MarketerCandidateInput,
  inScope: Set<string>,
  assignableStateCodes: string[]
): MarketerSkipReason | null {
  if (order.marketerId !== null) return "marketer_already_set";
  if (!order.consigneeId) return "no_consignee";
  if (!inScope.has(order.consigneeId)) return "out_of_scope_customer";
  if (order.isArchived) return "archived";
  if (!order.stateCode || !assignableStateCodes.includes(order.stateCode)) {
    return "state_not_assignable";
  }
  return null;
}
