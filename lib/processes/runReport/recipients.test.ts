import { describe, it, expect } from "vitest";
import { parseRecipients, validateRecipients } from "./recipients";

describe("parseRecipients", () => {
  it("returns a single-element list for one address with no delimiter", () => {
    expect(parseRecipients("tim@mackaysmarketing.com.au")).toEqual([
      "tim@mackaysmarketing.com.au",
    ]);
  });

  it("splits on commas", () => {
    expect(parseRecipients("a@x.com,b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("splits on semicolons", () => {
    expect(parseRecipients("a@x.com;b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("splits on a mix of commas and semicolons", () => {
    expect(parseRecipients("a@x.com, b@x.com; c@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("trims surrounding whitespace on each address", () => {
    expect(parseRecipients("  a@x.com  ,  b@x.com  ")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("drops empty entries from trailing/leading/doubled delimiters", () => {
    expect(parseRecipients("a@x.com,,b@x.com,")).toEqual(["a@x.com", "b@x.com"]);
    expect(parseRecipients(",a@x.com")).toEqual(["a@x.com"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });
});

describe("validateRecipients", () => {
  it("accepts a single valid address", () => {
    expect(validateRecipients("tim@mackaysmarketing.com.au")).toEqual({
      valid: true,
      emails: ["tim@mackaysmarketing.com.au"],
    });
  });

  it("accepts multiple valid addresses, comma or semicolon separated", () => {
    expect(validateRecipients("a@x.com, b@x.com; c@x.com")).toEqual({
      valid: true,
      emails: ["a@x.com", "b@x.com", "c@x.com"],
    });
  });

  it("rejects an empty list with a clear message", () => {
    const result = validateRecipients("   ");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("At least one");
  });

  it("rejects if any single address in the list is malformed, naming it", () => {
    const result = validateRecipients("a@x.com, not-an-email, b@x.com");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("not-an-email");
  });

  it("does not flag the other addresses when only one is malformed", () => {
    const result = validateRecipients("a@x.com, bad, c@x.com");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).not.toContain("a@x.com");
      expect(result.error).not.toContain("c@x.com");
    }
  });
});
