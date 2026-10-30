import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { loadEnabledRuleRows } from "./resolveRules";

const mockAdmin = vi.mocked(createAdminClient);

/** A Supabase client whose select() answers in turn from `answers`. */
function client(answers: Array<{ data: unknown; error: { code: string; message: string } | null }>) {
  const selects: string[] = [];
  const from = () => ({
    select: (cols: string) => {
      selects.push(cols);
      const answer = answers[selects.length - 1];
      return { eq: async () => answer };
    },
  });
  mockAdmin.mockReturnValue({ from } as never);
  return selects;
}

const legacyRow = {
  id: "r1",
  consignee_entity_code: "COLME",
  consignee_freshtrack_id: "c-colme",
  crop_id: null,
  crop_name: null,
  consignor_entity_code: "MMTRU",
  consignor_freshtrack_id: "r-mmtru",
};

beforeEach(() => {
  mockAdmin.mockReset();
});

describe("loadEnabledRuleRows", () => {
  it("reads the new columns once migration 00024 is applied", async () => {
    const row = { ...legacyRow, product_id: null, product_code: null, product_name: null, action: "assign" };
    const selects = client([{ data: [row], error: null }]);
    expect(await loadEnabledRuleRows()).toEqual([row]);
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("product_id");
  });

  it("before the migration, falls back to the old columns as plain assign rules", async () => {
    const selects = client([
      { data: null, error: { code: "42703", message: "column consignor_assignment_rules.product_id does not exist" } },
      { data: [legacyRow], error: null },
    ]);
    expect(await loadEnabledRuleRows()).toEqual([
      { ...legacyRow, product_id: null, product_code: null, product_name: null, action: "assign" },
    ]);
    expect(selects[1]).not.toContain("product_id");
  });

  it("any other database error still fails the run", async () => {
    client([{ data: null, error: { code: "57014", message: "statement timeout" } }]);
    await expect(loadEnabledRuleRows()).rejects.toThrow("statement timeout");
  });
});
