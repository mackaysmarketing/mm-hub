import { describe, it, expect, vi } from "vitest";

// portal-access.ts imports the Supabase server client (which pulls next/headers)
// at module load. The filter functions themselves are pure; stub the server
// module so the import resolves in a plain node test environment.
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));

import {
  getGrowerFilter,
  getRecipientFilter,
  hasMenuAccess,
  type PortalAccessContext,
} from "./portal-access";

const ctx = (over: Partial<PortalAccessContext> = {}): PortalAccessContext => ({
  growerGroupId: "group-A",
  growerIds: [],
  recipientIds: [],
  isInternal: false,
  allowedMenuItems: [],
  financialAccess: {},
  moduleRole: "grower",
  capabilities: [],
  ...over,
});

describe("getGrowerFilter — farm-axis scoping", () => {
  it("returns the caller's resolved farm ids when nothing specific requested", () => {
    expect(getGrowerFilter(ctx({ growerIds: ["a", "b"] }))).toEqual(["a", "b"]);
  });

  it("allows a requested farm within the caller's scope", () => {
    expect(getGrowerFilter(ctx({ growerIds: ["a", "b"] }), "a")).toEqual(["a"]);
  });

  it("DENIES a requested farm outside the caller's scope (returns [])", () => {
    expect(getGrowerFilter(ctx({ growerIds: ["a", "b"] }), "z")).toEqual([]);
  });

  it("FIX (was the AC-2 IDOR): a grower-side user cannot request a foreign farm", () => {
    // Previously, growerIds=null (all-in-group) made the filter trust any client
    // id. Now grower-side contexts carry a concrete resolved list, so a farm from
    // another group is denied at the app layer (defense-in-depth over RLS).
    const groupAFarms = ctx({ isInternal: false, growerIds: ["farm-A1", "farm-A2"] });
    expect(getGrowerFilter(groupAFarms, "farm-in-group-B")).toEqual([]);
  });

  it("internal users (null = all tenants) may target any farm", () => {
    expect(getGrowerFilter(ctx({ isInternal: true, growerIds: null }), "any-farm")).toEqual([
      "any-farm",
    ]);
  });
});

describe("hasMenuAccess — server-side menu-item enforcement (AC-5 fix)", () => {
  it("internal users (allowedMenuItems null) can access any page", () => {
    expect(hasMenuAccess(ctx({ allowedMenuItems: null }), "Remittances")).toBe(true);
  });

  it("grants a page in the caller's allowed list", () => {
    expect(hasMenuAccess(ctx({ allowedMenuItems: ["Dashboard", "Sales & Pricing"] }), "Dashboard")).toBe(
      true
    );
  });

  it("DENIES a page the caller was not granted (no longer cosmetic)", () => {
    expect(hasMenuAccess(ctx({ allowedMenuItems: ["Dashboard"] }), "Remittances")).toBe(false);
  });
});

describe("getRecipientFilter — financial-axis scoping", () => {
  it("returns the caller's recipient ids when nothing specific requested", () => {
    expect(getRecipientFilter(ctx({ recipientIds: ["r1"] }))).toEqual(["r1"]);
  });

  it("allows a requested recipient within scope, denies one outside", () => {
    const c = ctx({ recipientIds: ["r1", "r2"] });
    expect(getRecipientFilter(c, "r1")).toEqual(["r1"]);
    expect(getRecipientFilter(c, "r-foreign")).toEqual([]);
  });

  it("internal users may target any recipient", () => {
    expect(getRecipientFilter(ctx({ isInternal: true, recipientIds: null }), "r9")).toEqual([
      "r9",
    ]);
  });
});
