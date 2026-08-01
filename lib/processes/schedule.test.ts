import { describe, it, expect } from "vitest";
import { brisbaneHour, isRunDue, parseSchedule, describeSchedule } from "./schedule";

// Brisbane = UTC+10, no DST — 00:00 UTC is 10:00 Brisbane.
function utc(hour: number): Date {
  return new Date(Date.UTC(2026, 6, 30, hour, 0, 0));
}

describe("brisbaneHour", () => {
  it("adds the fixed 10h offset", () => {
    expect(brisbaneHour(utc(0))).toBe(10);
    expect(brisbaneHour(utc(14))).toBe(0);
  });

  it("wraps past midnight", () => {
    expect(brisbaneHour(utc(20))).toBe(6); // 20 + 10 = 30 -> 6
  });
});

describe("isRunDue", () => {
  it("hourly is always due", () => {
    for (let h = 0; h < 24; h++) {
      expect(isRunDue({ frequency: "hourly" }, utc(h))).toBe(true);
    }
  });

  it("every_n_hours fires only on multiples of n (Brisbane hour)", () => {
    const schedule = { frequency: "every_n_hours" as const, n: 4 };
    // Brisbane hour 0 <=> UTC 14
    expect(isRunDue(schedule, utc(14))).toBe(true); // brisbane 0
    expect(isRunDue(schedule, utc(18))).toBe(true); // brisbane 4
    expect(isRunDue(schedule, utc(15))).toBe(false); // brisbane 1
  });

  it("every_n_hours rejects a non-positive or non-integer n rather than throwing", () => {
    expect(isRunDue({ frequency: "every_n_hours", n: 0 }, utc(0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: -3 }, utc(0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: 1.5 }, utc(0))).toBe(false);
  });

  it("daily fires only at the configured Brisbane hour", () => {
    const schedule = { frequency: "daily" as const, at_hour_brisbane: 0 };
    expect(isRunDue(schedule, utc(14))).toBe(true); // brisbane 0
    expect(isRunDue(schedule, utc(15))).toBe(false); // brisbane 1
    expect(isRunDue(schedule, utc(13))).toBe(false); // brisbane 23 (prev day)
  });

  it("daily at midnight Brisbane matches the design doc's original ask", () => {
    // "0 14 * * *" UTC was the doc's own answer for midnight Brisbane.
    expect(
      isRunDue({ frequency: "daily", at_hour_brisbane: 0 }, utc(14))
    ).toBe(true);
  });
});

describe("parseSchedule", () => {
  it("parses each valid shape", () => {
    expect(parseSchedule({ frequency: "hourly" })).toEqual({ frequency: "hourly" });
    expect(parseSchedule({ frequency: "every_n_hours", n: 4 })).toEqual({
      frequency: "every_n_hours",
      n: 4,
    });
    expect(
      parseSchedule({ frequency: "daily", at_hour_brisbane: 0 })
    ).toEqual({ frequency: "daily", at_hour_brisbane: 0 });
  });

  it("rejects garbage instead of throwing", () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule(undefined)).toBeNull();
    expect(parseSchedule("hourly")).toBeNull(); // must be an object, not a bare string
    expect(parseSchedule({})).toBeNull();
    expect(parseSchedule({ frequency: "weekly" })).toBeNull();
    expect(parseSchedule({ frequency: "daily", at_hour_brisbane: 25 })).toBeNull();
    expect(parseSchedule({ frequency: "daily", at_hour_brisbane: -1 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_hours" })).toBeNull(); // missing n
  });
});

describe("describeSchedule", () => {
  it("renders hourly plainly", () => {
    expect(describeSchedule({ frequency: "hourly" })).toBe("hourly");
  });

  it("renders every_n_hours, collapsing n=1 to 'hourly'", () => {
    expect(describeSchedule({ frequency: "every_n_hours", n: 4 })).toBe("every 4 hours");
    expect(describeSchedule({ frequency: "every_n_hours", n: 1 })).toBe("hourly");
  });

  it("renders daily with 12-hour Brisbane time, including the midnight/midday edge cases", () => {
    expect(describeSchedule({ frequency: "daily", at_hour_brisbane: 0 })).toBe(
      "daily at 12am Brisbane time"
    );
    expect(describeSchedule({ frequency: "daily", at_hour_brisbane: 7 })).toBe(
      "daily at 7am Brisbane time"
    );
    expect(describeSchedule({ frequency: "daily", at_hour_brisbane: 12 })).toBe(
      "daily at 12pm Brisbane time"
    );
    expect(describeSchedule({ frequency: "daily", at_hour_brisbane: 19 })).toBe(
      "daily at 7pm Brisbane time"
    );
  });
});
