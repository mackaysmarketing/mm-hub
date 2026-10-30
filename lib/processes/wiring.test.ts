import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/freshtrack-graphql", () => ({ gqlQuery: vi.fn() }));
vi.mock("@/lib/resend", () => ({ sendEmail: vi.fn() }));
import { DECISION_SKIP_REASONS } from "./consignorAssign/decisionReasons";
import * as registry from "./registry";

describe("what counts as needs a decision", () => {
  it("mixed leave-blank orders do; green-only ones do not", () => {
    expect(DECISION_SKIP_REASONS).toContain("mixed_leave_blank");
    expect(DECISION_SKIP_REASONS).not.toContain("left_blank_by_rule");
  });
});

describe("registry", () => {
  it("has a runner for the marketer fill", async () => {
    vi.mocked((await import("./runner")).getProcessDefinition);
    expect(registry).toHaveProperty("runProcess");
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./registry.ts", import.meta.url), "utf8"));
    expect(src).toMatch(/marketer_auto_fill:\s*runMarketerAutoFill/);
  });
});
