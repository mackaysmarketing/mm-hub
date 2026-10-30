import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));

import { gqlQuery } from "@/lib/freshtrack-graphql";
import { Q_ORDER_BY_ID, Q_UPDATE_ORDER, type FTOrder } from "@/lib/freshtrack/queries";
import { applyConsignor, applyMarketer, clearMarketer } from "./apply";

const mockGql = vi.mocked(gqlQuery);

const MACKM_MARKETER = "0192035b-0cf8-4e5f-8675-e6144ff7df99";
const MACKM_CONSIGNOR = "019640d5-7626-4712-c3e0-cab1ab15b4f6";

function order(over: Partial<FTOrder> = {}): FTOrder {
  return {
    id: "order-1",
    priority: null,
    type: "S",
    orderNo: "5031150",
    salesOrderNo: "",
    poNo: "111722150",
    comment: "",
    info: "",
    scheduledPickupOn: "2026-11-06T14:00:00+00:00",
    actualPickupOn: null,
    scheduledDeliveryOn: "2026-11-07T14:00:00+00:00",
    actualDeliveryOn: null,
    isEdi: false,
    ediStatus: null,
    totalOrdered: 240,
    isArchived: false,
    stateId: "state-or",
    consignorId: null,
    consigneeId: "c-wowmi",
    parentConsigneeId: "c-wowgl",
    marketAreaId: null,
    marketerId: null,
    supplierId: null,
    deliveryContactId: null,
    shedId: null,
    saleEntityId: null,
    latestVersionNo: 1,
    ...over,
  };
}

/**
 * Scripted FreshTrack: the first order fetch returns `before`, the update
 * records what was sent, and every later fetch returns `after`.
 */
function script(before: FTOrder, after: FTOrder) {
  const sent: Array<Record<string, unknown>> = [];
  let fetches = 0;
  mockGql.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    if (query === Q_ORDER_BY_ID) {
      fetches++;
      return { orders: [fetches === 1 ? before : after] } as never;
    }
    if (query === Q_UPDATE_ORDER) {
      sent.push(vars?.orderData as Record<string, unknown>);
      return { updateOrder: { order: after } } as never;
    }
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  });
  return sent;
}

beforeEach(() => mockGql.mockReset());

describe("applyMarketer", () => {
  it("fills a blank marketer and changes nothing else on the order", async () => {
    const before = order({ consignorId: MACKM_CONSIGNOR, comment: "keep me" });
    const sent = script(before, { ...before, marketerId: MACKM_MARKETER });

    const result = await applyMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("applied");
    expect(sent).toHaveLength(1);
    expect(sent[0].marketerId).toBe(MACKM_MARKETER);
    // Every other OrderInput field is the fresh fetch's own value.
    expect(sent[0].consignorId).toBe(MACKM_CONSIGNOR);
    expect(sent[0].comment).toBe("keep me");
    expect(sent[0].poNo).toBe("111722150");
    expect(sent[0].stateId).toBe("state-or");
  });

  it("never overwrites a marketer someone has set since discovery", async () => {
    const before = order({ marketerId: "third-party-marketer" });
    const sent = script(before, before);

    const result = await applyMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("already_assigned_by_other");
    expect(sent).toHaveLength(0);
  });

  it("fails loudly if anything other than the marketer changed in the write", async () => {
    const before = order();
    script(before, { ...before, marketerId: MACKM_MARKETER, consignorId: "surprise" });

    const result = await applyMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toMatch(/consignorId/);
  });

  it("fails if FreshTrack did not keep the new marketer", async () => {
    const before = order();
    script(before, before);

    const result = await applyMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toMatch(/marketerId after write/);
  });
});

describe("clearMarketer (the undo)", () => {
  it("clears only the marketer this tool set", async () => {
    const before = order({ marketerId: MACKM_MARKETER });
    const sent = script(before, { ...before, marketerId: null });

    const result = await clearMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("applied");
    expect(sent[0].marketerId).toBeNull();
  });

  it("leaves a marketer alone if it is no longer the one this tool set", async () => {
    const before = order({ marketerId: "someone-else" });
    const sent = script(before, before);

    const result = await clearMarketer("order-1", MACKM_MARKETER);

    expect(result.outcome).toBe("already_assigned_by_other");
    expect(sent).toHaveLength(0);
  });
});

describe("applyConsignor — unchanged, and now also guards the marketer", () => {
  it("still fills a blank consignor", async () => {
    const before = order();
    const sent = script(before, { ...before, consignorId: "r-mmann" });

    const result = await applyConsignor("order-1", "r-mmann");

    expect(result.outcome).toBe("applied");
    expect(sent[0].consignorId).toBe("r-mmann");
    expect(sent[0].marketerId).toBeNull();
  });

  it("fails if a consignor write also moved the marketer", async () => {
    const before = order();
    script(before, { ...before, consignorId: "r-mmann", marketerId: "moved" });

    const result = await applyConsignor("order-1", "r-mmann");

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toMatch(/marketerId/);
  });
});
