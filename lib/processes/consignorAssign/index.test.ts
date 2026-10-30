import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));
vi.mock("./resolveRules", () => ({ resolveRules: vi.fn() }));
vi.mock("./apply", () => ({ applyConsignor: vi.fn() }));
vi.mock("./conflictAlert", () => ({ maybeSendConflictAlert: vi.fn() }));
vi.mock("../runner", () => ({ logAction: vi.fn() }));

import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ORDER_STATES,
  Q_ORDERS_BY_CONSIGNEES,
  Q_ORDER_VERSIONS_BY_ORDER,
  Q_ORDER_ITEMS_BY_ORDER_VERSION,
  Q_PRODUCTS_ALL,
} from "@/lib/freshtrack/queries";
import { resolveRules } from "./resolveRules";
import { applyConsignor } from "./apply";
import { maybeSendConflictAlert } from "./conflictAlert";
import { logAction } from "../runner";
import { runConsignorAutoAssign } from "./index";
import type { AssignmentRule } from "./matchOrder";

const mockGql = vi.mocked(gqlQuery);
const mockRules = vi.mocked(resolveRules);
const mockApply = vi.mocked(applyConsignor);
const mockAlert = vi.mocked(maybeSendConflictAlert);
const mockLog = vi.mocked(logAction);

const rule = (over: Partial<AssignmentRule> & Pick<AssignmentRule, "id">): AssignmentRule => ({
  consigneeFreshtrackId: null,
  cropId: null,
  productId: null,
  action: "assign",
  consignorFreshtrackId: null,
  consignorEntityCode: null,
  ...over,
});

const RULES: AssignmentRule[] = [
  rule({ id: "wowto-green15-blank", consigneeFreshtrackId: "c-wowto", productId: "p-910101", action: "leave_blank" }),
  rule({ id: "wowto-banana", consigneeFreshtrackId: "c-wowto", cropId: "crop-banana", consignorFreshtrackId: "r-mmann", consignorEntityCode: "MMANN" }),
  rule({ id: "wowto-ripecollar", consigneeFreshtrackId: "c-wowto", productId: "p-910111", consignorFreshtrackId: "r-sqbrl", consignorEntityCode: "SQBRL" }),
  rule({ id: "colme-default", consigneeFreshtrackId: "c-colme", consignorFreshtrackId: "r-mmtru", consignorEntityCode: "MMTRU" }),
];

const PRODUCTS = [
  { id: "p-910101", code: "910101", name: "Green 15kg", cropId: "crop-banana" },
  { id: "p-910102", code: "910102", name: "Semi ripe 15kg", cropId: "crop-banana" },
  { id: "p-910111", code: "910111", name: "Ripe collars", cropId: "crop-banana" },
  { id: "p-papaya", code: "920101", name: "Papaya S", cropId: "crop-papaya" },
];

// order id -> consignee and the products on its latest version
const ORDERS: Record<string, { consigneeId: string; products: string[] }> = {
  A: { consigneeId: "c-wowto", products: ["p-910101"] }, // green only
  B: { consigneeId: "c-wowto", products: ["p-910101", "p-910102"] }, // green + semi ripe
  C: { consigneeId: "c-wowto", products: ["p-910111"] }, // ripe collars
  D: { consigneeId: "c-colme", products: ["p-papaya"] }, // existing customer, untouched by the change
};

beforeEach(() => {
  for (const m of [mockGql, mockRules, mockApply, mockAlert, mockLog]) m.mockReset();
  mockRules.mockResolvedValue({
    validRules: RULES,
    invalidRules: [],
    consigneeNameById: new Map([["c-wowto", "Woolworths Townsville"], ["c-colme", "Coles Melbourne"]]),
  });
  mockAlert.mockResolvedValue(undefined);
  mockGql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    if (query === Q_ORDER_STATES) return { orderStates: [{ id: "s-or", code: "OR", name: "Ordered", sequence: 1, isActive: true }] } as never;
    if (query === Q_ORDERS_BY_CONSIGNEES) {
      return {
        orders: Object.entries(ORDERS).map(([id, o]) => ({
          id,
          orderNo: `ord-${id}`,
          consignorId: null,
          consigneeId: o.consigneeId,
          stateId: "s-or",
          isArchived: false,
          actualPickupOn: null,
          actualDeliveryOn: null,
          scheduledDeliveryOn: "2026-11-07T14:00:00+00:00",
        })),
      } as never;
    }
    if (query === Q_ORDER_VERSIONS_BY_ORDER) return { orderVersions: [{ id: `v-${vars?.orderId}`, versionNo: 1 }] } as never;
    if (query === Q_ORDER_ITEMS_BY_ORDER_VERSION) {
      const orderId = String(vars?.orderVersionId).slice(2);
      return { orderItems: ORDERS[orderId].products.map((productId) => ({ productId })) } as never;
    }
    if (query === Q_PRODUCTS_ALL) return { products: PRODUCTS } as never;
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  });
});

const ctx = {
  runId: "run-1",
  processKey: "consignor_auto_assign",
  mode: "dry_run" as const,
  config: { assignable_state_codes: ["OR"] },
};

describe("runConsignorAutoAssign — product rules", () => {
  it("routes each order by its products, and only the mixed one needs a person", async () => {
    await runConsignorAutoAssign(ctx);

    const byRef = new Map(mockLog.mock.calls.map((c) => [c[0].targetRef, c[0]]));
    expect(byRef.get("ord-A")).toMatchObject({ status: "skipped", skipReason: "left_blank_by_rule" });
    expect(byRef.get("ord-B")).toMatchObject({ status: "skipped", skipReason: "mixed_leave_blank" });
    expect(byRef.get("ord-C")).toMatchObject({ status: "proposed", ruleId: "wowto-ripecollar", after: { code: "SQBRL" } });
    expect(byRef.get("ord-D")).toMatchObject({ status: "proposed", ruleId: "colme-default", after: { code: "MMTRU" } });

    // Green-only is the expected outcome, so it must not raise an alert.
    const conflicts = mockAlert.mock.calls[0][0].conflicts;
    expect(conflicts.map((c) => [c.targetRef, c.skipReason])).toEqual([["ord-B", "mixed_leave_blank"]]);
  });

  it("never writes in dry run", async () => {
    await runConsignorAutoAssign(ctx);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("writes only the assignable orders in apply mode", async () => {
    mockApply.mockResolvedValue({ outcome: "applied" } as never);
    await runConsignorAutoAssign({ ...ctx, mode: "apply" });
    expect(mockApply.mock.calls).toEqual([
      ["C", "r-sqbrl"],
      ["D", "r-mmtru"],
    ]);
  });
});
