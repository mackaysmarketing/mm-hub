import { describe, it, expect, vi } from "vitest";

// portal-access.ts imports the Supabase server client (which pulls next/headers)
// at module load. getGrowerFilter itself is pure; stub the server module so the
// import resolves in a plain node test environment.
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));

import { getGrowerFilter, type PortalAccessContext } from "./portal-access";

const baseCtx = (over: Partial<PortalAccessContext> = {}): PortalAccessContext => ({
  growerGroupId: "group-A",
  growerIds: null,
  financialAccess: {},
  moduleRole: "grower",
  capabilities: [],
  ...over,
});

describe("getGrowerFilter — behaviour that is correct today", () => {
  it("returns the user's assigned grower_ids when no specific grower requested", () => {
    const ctx = baseCtx({ growerIds: ["a", "b"] });
    expect(getGrowerFilter(ctx)).toEqual(["a", "b"]);
  });

  it("returns null (all-in-group) when growerIds is null and nothing requested", () => {
    expect(getGrowerFilter(baseCtx({ growerIds: null }))).toBeNull();
  });

  it("allows a requested grower the user is scoped to", () => {
    const ctx = baseCtx({ growerIds: ["a", "b"] });
    expect(getGrowerFilter(ctx, "a")).toEqual(["a"]);
  });

  it("DENIES a requested grower outside the user's scoped grower_ids", () => {
    const ctx = baseCtx({ growerIds: ["a", "b"] });
    expect(getGrowerFilter(ctx, "z")).toEqual([]); // empty = no access
  });
});

describe("getGrowerFilter — IDOR (executable evidence of finding AC-2)", () => {
  // When growerIds is null (grower_admin / 'all farms in group'), a client-supplied
  // growerId is returned VERBATIM with no check that it belongs to the caller's
  // grower_group. This is the confirmed horizontal-access hole.

  it("CHARACTERIZATION: currently trusts an arbitrary requested grower when growerIds is null", () => {
    const ctx = baseCtx({ growerIds: null, growerGroupId: "group-A" });
    // Documents today's vulnerable behaviour: a grower from another group is accepted.
    expect(getGrowerFilter(ctx, "grower-in-group-B")).toEqual(["grower-in-group-B"]);
  });

  it.fails(
    "SECURITY GOAL (red until Sprint 2): must NOT return a grower outside the caller's group",
    () => {
      const ctx = baseCtx({ growerIds: null, growerGroupId: "group-A" });
      // After getGrowerFilter is made group-aware, a foreign grower must be denied.
      // This assertion fails today (returns ["grower-in-group-B"]); when it starts
      // passing, remove `.fails` — the boundary is fixed.
      expect(getGrowerFilter(ctx, "grower-in-group-B")).toEqual([]);
    }
  );
});
