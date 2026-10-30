import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));
vi.mock("../runner", () => ({ logAction: vi.fn() }));
vi.mock("../consignorAssign/apply", () => ({ applyMarketer: vi.fn() }));

import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FOR_MARKETER_SCOPE,
  Q_ORDER_STATES,
  Q_ORDERS_FOR_MARKETER_FILL,
} from "@/lib/freshtrack/queries";
import { logAction } from "../runner";
import { applyMarketer } from "../consignorAssign/apply";
import { runMarketerAutoFill } from "./index";
import { MARKETER_DEFAULTS } from "./config";

const mockGql = vi.mocked(gqlQuery);
const mockLog = vi.mocked(logAction);
const mockApply = vi.mocked(applyMarketer);

const ENTITIES = [
  { id: "e-wowgl", code: "WOWGL", orgName: "Woolworths Head Office", parentId: null, parent: null, consigneeId: "c-wowgl", marketerId: null, isMarketerActive: false },
  { id: "e-wowmi", code: "WOWMI", orgName: "Woolworths Minchinbury", parentId: "e-wowgl", parent: { id: "e-wowgl", code: "WOWGL" }, consigneeId: "c-wowmi", marketerId: null, isMarketerActive: false },
  { id: "e-wowta", code: "WOWTA", orgName: "Woolworths Tasmania", parentId: "e-wowgl", parent: { id: "e-wowgl", code: "WOWGL" }, consigneeId: "c-wowta", marketerId: null, isMarketerActive: false },
  { id: "e-mackm", code: "MACKM", orgName: "Mackays Marketing", parentId: null, parent: null, consigneeId: null, marketerId: "m-mackm", isMarketerActive: true },
];
const STATES = [
  { id: "s-or", code: "OR", name: "Ordered", sequence: 1, isActive: true },
  { id: "s-ford", code: "FORD", name: "Farm Order", sequence: 2, isActive: true },
  { id: "s-ca", code: "CA", name: "Cancelled", sequence: 8, isActive: true },
];

function ftOrder(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    orderNo: `50${id}`,
    marketerId: null,
    consignorId: null,
    consigneeId: "c-wowmi",
    stateId: "s-or",
    isArchived: false,
    scheduledDeliveryOn: "2026-11-07T14:00:00+00:00",
    ...over,
  };
}

let discoveryVars: Record<string, unknown> | undefined;
function freshtrack(orders: ReturnType<typeof ftOrder>[]) {
  mockGql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    if (query === Q_ENTITIES_FOR_MARKETER_SCOPE) return { entities: ENTITIES } as never;
    if (query === Q_ORDER_STATES) return { orderStates: STATES } as never;
    if (query === Q_ORDERS_FOR_MARKETER_FILL) {
      discoveryVars = vars;
      return { orders } as never;
    }
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  });
}

const ctx = (mode: "dry_run" | "apply", config: Record<string, unknown> = MARKETER_DEFAULTS as unknown as Record<string, unknown>) => ({
  runId: "run-1",
  processKey: "marketer_auto_fill",
  mode,
  config,
});

const logged = () => mockLog.mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockGql.mockReset();
  mockLog.mockReset();
  mockApply.mockReset();
  discoveryVars = undefined;
});

describe("runMarketerAutoFill", () => {
  it("asks FreshTrack only for open orders of the Woolworths DCs", async () => {
    freshtrack([]);
    await runMarketerAutoFill(ctx("dry_run"));
    expect([...(discoveryVars?.consigneeIds as string[])].sort()).toEqual(["c-wowgl", "c-wowmi", "c-wowta"]);
    expect([...(discoveryVars?.stateIds as string[])].sort()).toEqual(["s-ford", "s-or"]);
  });

  it("dry run proposes the blank ones and writes nothing", async () => {
    freshtrack([ftOrder("1"), ftOrder("2", { marketerId: "m-third-party" }), ftOrder("3", { consigneeId: "c-wowta" })]);

    const result = await runMarketerAutoFill(ctx("dry_run"));

    expect(mockApply).not.toHaveBeenCalled();
    expect(result).toMatchObject({ candidatesSeen: 2, actionsProposed: 2, actionsApplied: 0, actionsFailed: 0 });
    expect(logged().map((r) => [r.targetRef, r.status, r.action])).toEqual([
      ["501", "proposed", "set_marketer"],
      ["503", "proposed", "set_marketer"],
    ]);
    expect(logged()[0]).toMatchObject({
      consigneeName: "Woolworths Minchinbury",
      before: { marketer_ft_id: null },
      after: { marketer_ft_id: "m-mackm", code: "MACKM" },
    });
  });

  it("apply fills each blank one, and backs off one set by someone else meanwhile", async () => {
    freshtrack([ftOrder("1"), ftOrder("2"), ftOrder("3")]);
    mockApply
      .mockResolvedValueOnce({ outcome: "applied" } as never)
      .mockResolvedValueOnce({ outcome: "already_assigned_by_other" } as never)
      .mockResolvedValueOnce({ outcome: "failed", error: "boom" } as never);

    const result = await runMarketerAutoFill(ctx("apply"));

    expect(mockApply).toHaveBeenCalledWith("1", "m-mackm", expect.any(Function));
    expect(result).toMatchObject({ actionsApplied: 1, actionsSkipped: 1, actionsFailed: 1 });
    expect(logged().map((r) => [r.targetRef, r.status, r.skipReason ?? null, r.error ?? null])).toEqual([
      ["501", "applied", null, null],
      ["502", "skipped", "already_assigned_by_other", null],
      ["503", "failed", null, "boom"],
    ]);
  });

  it("skips, and never writes, an order outside the groups or in a closed state that slips through", async () => {
    freshtrack([ftOrder("1", { consigneeId: "c-colme" }), ftOrder("2", { stateId: "s-ca" })]);

    const result = await runMarketerAutoFill(ctx("apply"));

    expect(mockApply).not.toHaveBeenCalled();
    expect(result).toMatchObject({ actionsSkipped: 2, actionsApplied: 0 });
    expect(logged().map((r) => r.skipReason)).toEqual(["out_of_scope_customer", "state_not_assignable"]);
  });

  it("stops with a clear error, before any order query, when the group or marketer is wrong", async () => {
    freshtrack([ftOrder("1")]);
    await expect(
      runMarketerAutoFill(ctx("apply", { ...MARKETER_DEFAULTS, marketer_entity_code: "NOPE" }))
    ).rejects.toThrow("Marketer NOPE was not found in FreshTrack.");
    expect(discoveryVars).toBeUndefined();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("does nothing when no state is ticked", async () => {
    freshtrack([ftOrder("1")]);
    const result = await runMarketerAutoFill(ctx("apply", { ...MARKETER_DEFAULTS, assignable_state_codes: [] }));
    expect(discoveryVars).toBeUndefined();
    expect(result).toMatchObject({ candidatesSeen: 0, partial: true });
  });

  it("says so when discovery hits its row limit", async () => {
    freshtrack(Array.from({ length: 2000 }, (_, i) => ftOrder(String(i), { marketerId: "m-mackm" })));
    const result = await runMarketerAutoFill(ctx("dry_run"));
    expect(result.payload).toMatchObject({ discovery_limit_hit: true });
  });
});

describe("runMarketerAutoFill — changes between discovery and write", () => {
  it("passes a re-check that refuses an order cancelled or moved out of scope meanwhile", async () => {
    freshtrack([ftOrder("1")]);
    mockApply.mockResolvedValueOnce({ outcome: "no_longer_eligible", reason: "state_not_assignable", error: "x" } as never);
    const result = await runMarketerAutoFill(ctx("apply"));
    const recheck = mockApply.mock.calls[0][2]!;
    const fresh = { consigneeId: "c-wowmi", isArchived: false, stateId: "s-or" } as never;
    expect(recheck(fresh)).toBeNull();
    expect(recheck({ ...(fresh as object), stateId: "s-ca" } as never)).toBe("state_not_assignable");
    expect(recheck({ ...(fresh as object), consigneeId: "c-colme" } as never)).toBe("out_of_scope_customer");
    expect(recheck({ ...(fresh as object), isArchived: true } as never)).toBe("archived");
    expect(result).toMatchObject({ actionsApplied: 0, actionsSkipped: 1 });
    expect(logged()[0]).toMatchObject({ status: "skipped", skipReason: "changed_since_discovery" });
  });

  it("uses the configured groups and window, not the defaults", async () => {
    freshtrack([]);
    await runMarketerAutoFill(ctx("dry_run", { ...MARKETER_DEFAULTS, customer_group_codes: ["NOPE"] })).catch((e) => e);
    expect(discoveryVars).toBeUndefined(); // unknown group stops the run
    const now = Date.now();
    await runMarketerAutoFill(ctx("dry_run", { ...MARKETER_DEFAULTS, discovery_lookback_days: 10 }));
    const start = Date.parse(String(discoveryVars?.deliveryStart));
    expect(Math.round((now - start) / 86_400_000)).toBe(10);
  });

  it("the default window reaches the oldest open blank-marketer PO (due 24 Jul 2026) from 30 Oct 2026", () => {
    const start = Date.parse("2026-10-30T00:00:00Z") - MARKETER_DEFAULTS.discovery_lookback_days * 86_400_000;
    expect(start).toBeLessThan(Date.parse("2026-07-24T00:00:00Z"));
  });
});
