import { describe, it, expect } from "vitest";
import { canUnassignConsignor, canUndoMarketerFill } from "./actionGuards";

const consignorApplied = {
  process_key: "consignor_auto_assign",
  action: "set_consignor",
  status: "applied",
  after: { consignor_ft_id: "r-mmann", code: "MMANN" },
};
const marketerApplied = {
  process_key: "marketer_auto_fill",
  action: "set_marketer",
  status: "applied",
  after: { marketer_ft_id: "m-mackm", code: "MACKM" },
};

describe("canUnassignConsignor", () => {
  it("allows only a consignor this tool actually set", () => {
    expect(canUnassignConsignor(consignorApplied)).toBe(true);
  });

  it("refuses a marketer fill — clearing its consignor would undo someone else's work", () => {
    expect(canUnassignConsignor(marketerApplied)).toBe(false);
  });

  it("checks the process, not just the action name", () => {
    expect(canUnassignConsignor({ ...consignorApplied, process_key: "marketer_auto_fill" })).toBe(false);
  });

  it("refuses rows that wrote nothing, and the undo rows themselves", () => {
    expect(canUnassignConsignor({ ...consignorApplied, status: "skipped" })).toBe(false);
    expect(canUnassignConsignor({ ...consignorApplied, status: "proposed" })).toBe(false);
    expect(canUnassignConsignor({ ...consignorApplied, action: "unassign_consignor" })).toBe(false);
  });
});

describe("canUndoMarketerFill", () => {
  it("allows only a marketer this tool actually set", () => {
    expect(canUndoMarketerFill(marketerApplied)).toBe(true);
  });

  it("checks the process, not just the action name", () => {
    expect(canUndoMarketerFill({ ...marketerApplied, process_key: "consignor_auto_assign" })).toBe(false);
  });

  it("refuses consignor rows, rows that wrote nothing, and rows with no marketer recorded", () => {
    expect(canUndoMarketerFill(consignorApplied)).toBe(false);
    expect(canUndoMarketerFill({ ...marketerApplied, status: "proposed" })).toBe(false);
    expect(canUndoMarketerFill({ ...marketerApplied, action: "clear_marketer" })).toBe(false);
    expect(canUndoMarketerFill({ ...marketerApplied, after: {} })).toBe(false);
    expect(canUndoMarketerFill({ ...marketerApplied, after: null })).toBe(false);
  });
});
