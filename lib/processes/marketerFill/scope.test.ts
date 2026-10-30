import { describe, it, expect } from "vitest";
import { resolveMarketerScope, checkMarketerCandidate, type ScopeEntity } from "./scope";
import { readMarketerConfig, validateMarketerConfig, MARKETER_DEFAULTS } from "./config";

function entity(over: Partial<ScopeEntity> & Pick<ScopeEntity, "id" | "code">): ScopeEntity {
  return {
    orgName: over.code,
    parentId: null,
    parent: null,
    consigneeId: null,
    marketerId: null,
    isMarketerActive: false,
    ...over,
  };
}

const WOWGL = entity({ id: "e-wowgl", code: "WOWGL", orgName: "Woolworths Head Office", consigneeId: "c-wowgl" });
const child = (code: string, name: string, consigneeId: string | null, parentCode = "WOWGL", parentId = "e-wowgl") =>
  entity({ id: `e-${code}`, code, orgName: name, consigneeId, parentId, parent: { id: parentId, code: parentCode } });

// Mirrors the live tree on 30 Oct 2026: Woolworths DCs under WOWGL, the
// avocado DCs under a separate head office, and Primary Connect with no
// consignee role at all.
const ENTITIES: ScopeEntity[] = [
  WOWGL,
  child("WOWBR", "Woolworths Brisbane", "c-wowbr"),
  child("WOWMI", "Woolworths Minchinbury", "c-wowmi"),
  child("WOWTA", "Woolworths Tasmania", "c-wowta"),
  child("WWPCO", "Woolworths Primary Connect", null),
  entity({ id: "e-wowga", code: "WOWGA", orgName: "Woolworths Head Office - Avocados", consigneeId: "c-wowga" }),
  child("WWBRA", "Woolworths Brisbane - Avocados", "c-wwbra", "WOWGA", "e-wowga"),
  entity({ id: "e-colme", code: "COLME", orgName: "Coles Melbourne", consigneeId: "c-colme" }),
  entity({ id: "e-mackm", code: "MACKM", orgName: "Mackays Marketing", marketerId: "m-mackm", isMarketerActive: true }),
  entity({ id: "e-macf", code: "MACKF", orgName: "Mac Farms", marketerId: "m-macf", isMarketerActive: false }),
];

describe("resolveMarketerScope", () => {
  it("Woolworths means the head office and every DC under it — and nothing else", () => {
    const out = resolveMarketerScope(ENTITIES, ["WOWGL"], "MACKM");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([...out.scope.consigneeIds].sort()).toEqual(["c-wowbr", "c-wowgl", "c-wowmi", "c-wowta"]);
    expect(out.scope.consigneeNameById.get("c-wowmi")).toBe("Woolworths Minchinbury");
    expect(out.scope.groups).toEqual([{ code: "WOWGL", name: "Woolworths Head Office", customerCount: 4 }]);
  });

  it("resolves the marketer to its marketer role id, not its entity id", () => {
    const out = resolveMarketerScope(ENTITIES, ["WOWGL"], "MACKM");
    expect(out.ok && out.scope.marketerRoleId).toBe("m-mackm");
    expect(out.ok && out.scope.marketerName).toBe("Mackays Marketing");
  });

  it("several groups add together", () => {
    const out = resolveMarketerScope(ENTITIES, ["WOWGL", "WOWGA"], "MACKM");
    expect(out.ok && out.scope.consigneeIds).toContain("c-wwbra");
    expect(out.ok && out.scope.consigneeIds).toContain("c-wowbr");
  });

  it("matches codes whatever their case or spacing", () => {
    const out = resolveMarketerScope(ENTITIES, [" wowgl "], " mackm ");
    expect(out.ok).toBe(true);
  });

  it("stops on a group FreshTrack does not have", () => {
    expect(resolveMarketerScope(ENTITIES, ["WOWGX"], "MACKM")).toEqual({
      ok: false,
      error: "Customer group WOWGX was not found in FreshTrack.",
    });
  });

  it("stops when no group is set", () => {
    expect(resolveMarketerScope(ENTITIES, [], "MACKM")).toEqual({
      ok: false,
      error: expect.stringMatching(/no customer group/i),
    });
  });

  it("stops on a marketer that is missing or not marketer-active", () => {
    expect(resolveMarketerScope(ENTITIES, ["WOWGL"], "NOPE")).toEqual({
      ok: false,
      error: "Marketer NOPE was not found in FreshTrack.",
    });
    expect(resolveMarketerScope(ENTITIES, ["WOWGL"], "MACKF")).toEqual({
      ok: false,
      error: "MACKF is not an active marketer in FreshTrack.",
    });
  });
});

describe("checkMarketerCandidate", () => {
  const SCOPE = new Set(["c-wowbr", "c-wowmi"]);
  const OPEN = ["OR", "FORD", "Default"];
  const base = { marketerId: null, consigneeId: "c-wowmi", isArchived: false, stateCode: "OR" };

  it("fills a blank-marketer Woolworths order in an open state", () => {
    expect(checkMarketerCandidate(base, SCOPE, OPEN)).toBeNull();
  });

  it("never touches an order that already has a marketer", () => {
    expect(checkMarketerCandidate({ ...base, marketerId: "third-party" }, SCOPE, OPEN)).toBe(
      "marketer_already_set"
    );
  });

  it("skips customers outside the groups, archived orders and closed states", () => {
    expect(checkMarketerCandidate({ ...base, consigneeId: "c-colme" }, SCOPE, OPEN)).toBe("out_of_scope_customer");
    expect(checkMarketerCandidate({ ...base, consigneeId: null }, SCOPE, OPEN)).toBe("no_consignee");
    expect(checkMarketerCandidate({ ...base, isArchived: true }, SCOPE, OPEN)).toBe("archived");
    expect(checkMarketerCandidate({ ...base, stateCode: "CA" }, SCOPE, OPEN)).toBe("state_not_assignable");
    expect(checkMarketerCandidate({ ...base, stateCode: null }, SCOPE, OPEN)).toBe("state_not_assignable");
  });
});

describe("marketer fill config", () => {
  it("defaults to Woolworths, Mackays Marketing, open orders, every 5 minutes", () => {
    expect(readMarketerConfig({})).toEqual(MARKETER_DEFAULTS);
    expect(MARKETER_DEFAULTS).toMatchObject({
      customer_group_codes: ["WOWGL"],
      marketer_entity_code: "MACKM",
      assignable_state_codes: ["OR", "FORD", "Default"],
      schedule: { frequency: "every_n_minutes", n: 5 },
    });
  });

  it("keeps stored values and falls back only for missing or broken ones", () => {
    const cfg = readMarketerConfig({ customer_group_codes: ["WOWGL", "WOWGA"], discovery_lookback_days: "x" });
    expect(cfg.customer_group_codes).toEqual(["WOWGL", "WOWGA"]);
    expect(cfg.discovery_lookback_days).toBe(MARKETER_DEFAULTS.discovery_lookback_days);
  });

  it("accepts a full, sensible config and tidies the codes", () => {
    const out = validateMarketerConfig({
      ...MARKETER_DEFAULTS,
      customer_group_codes: [" wowgl ", "WOWGL", "wowga"],
      marketer_entity_code: " mackm ",
      unknown_key: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.config.customer_group_codes).toEqual(["WOWGL", "WOWGA"]);
    expect(out.config.marketer_entity_code).toBe("MACKM");
    expect(out.config).not.toHaveProperty("unknown_key");
  });

  it("refuses a config that could not work", () => {
    const bad = [
      { ...MARKETER_DEFAULTS, customer_group_codes: [] },
      { ...MARKETER_DEFAULTS, customer_group_codes: [""] },
      { ...MARKETER_DEFAULTS, marketer_entity_code: "" },
      { ...MARKETER_DEFAULTS, schedule: { frequency: "sometimes" } },
      { ...MARKETER_DEFAULTS, assignable_state_codes: "OR" },
      { ...MARKETER_DEFAULTS, discovery_lookback_days: -1 },
      { ...MARKETER_DEFAULTS, discovery_lookback_days: 1.5 },
      { ...MARKETER_DEFAULTS, discovery_horizon_days: 0 },
      { ...MARKETER_DEFAULTS, discovery_horizon_days: 5000 },
      null,
    ];
    for (const config of bad) {
      expect(validateMarketerConfig(config).ok, JSON.stringify(config)).toBe(false);
    }
  });
});
