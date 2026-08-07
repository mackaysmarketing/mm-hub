import { describe, it, expect } from "vitest";
import {
  brisbaneHour,
  brisbaneMinute,
  isRunDue,
  parseSchedule,
  describeSchedule,
  isValidIntervalMinutes,
  intervalWrapGapMinutes,
  TICK_MINUTES,
} from "./schedule";

// Brisbane = UTC+10, no DST — 00:00 UTC is 10:00 Brisbane.
function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 6, 30, hour, minute, 0));
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

describe("brisbaneMinute", () => {
  it("is the UTC minute — the offset is a whole number of hours", () => {
    expect(brisbaneMinute(utc(3, 25))).toBe(25);
    expect(brisbaneMinute(utc(20, 0))).toBe(0); // still 0 across the day wrap
  });
});

describe("isRunDue — hour-based shapes under a sub-hourly tick", () => {
  /**
   * These are the regression guards for moving vercel.json from `0 * * * *` to
   * a 5-minute tick. Every one of these schedules was already stored in
   * process_definitions.config in production; before this change isRunDue was
   * only ever handed the top of an hour, so "hourly" could return true
   * unconditionally. Ticked every 5 minutes without a minute guard, that same
   * config would fire 12x an hour — the live report process is set to hourly.
   */
  it("hourly fires once an hour, not on every tick", () => {
    expect(isRunDue({ frequency: "hourly" }, utc(3, 0))).toBe(true);
    for (let m = TICK_MINUTES; m < 60; m += TICK_MINUTES) {
      expect(isRunDue({ frequency: "hourly" }, utc(3, m))).toBe(false);
    }
  });

  it("every_n_hours fires only on multiples of n (Brisbane hour), at :00", () => {
    const schedule = { frequency: "every_n_hours" as const, n: 4 };
    // Brisbane hour 0 <=> UTC 14
    expect(isRunDue(schedule, utc(14))).toBe(true); // brisbane 0
    expect(isRunDue(schedule, utc(18))).toBe(true); // brisbane 4
    expect(isRunDue(schedule, utc(15))).toBe(false); // brisbane 1
    expect(isRunDue(schedule, utc(14, 30))).toBe(false); // right hour, wrong minute
  });

  it("every_n_hours rejects a non-positive or non-integer n rather than throwing", () => {
    expect(isRunDue({ frequency: "every_n_hours", n: 0 }, utc(0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: -3 }, utc(0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: 1.5 }, utc(0))).toBe(false);
  });

  it("daily fires only at the configured Brisbane hour, at :00", () => {
    const schedule = { frequency: "daily" as const, at_hour_brisbane: 0 };
    expect(isRunDue(schedule, utc(14))).toBe(true); // brisbane 0
    expect(isRunDue(schedule, utc(15))).toBe(false); // brisbane 1
    expect(isRunDue(schedule, utc(13))).toBe(false); // brisbane 23 (prev day)
    expect(isRunDue(schedule, utc(14, 45))).toBe(false); // right hour, wrong minute
  });

  it("daily at midnight Brisbane matches the design doc's original ask", () => {
    // "0 14 * * *" UTC was the doc's own answer for midnight Brisbane.
    expect(
      isRunDue({ frequency: "daily", at_hour_brisbane: 0 }, utc(14))
    ).toBe(true);
  });

  it("the seeded report schedule (daily at 7am Brisbane) still fires exactly once a day", () => {
    const schedule = { frequency: "daily" as const, at_hour_brisbane: 7 };
    let fires = 0;
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += TICK_MINUTES) {
        if (isRunDue(schedule, utc(h, m))) fires++;
      }
    }
    expect(fires).toBe(1);
  });
});

describe("isRunDue — every_n_minutes", () => {
  it("fires on each multiple of n within the hour", () => {
    const schedule = { frequency: "every_n_minutes" as const, n: 15 };
    expect(isRunDue(schedule, utc(3, 0))).toBe(true);
    expect(isRunDue(schedule, utc(3, 15))).toBe(true);
    expect(isRunDue(schedule, utc(3, 30))).toBe(true);
    expect(isRunDue(schedule, utc(3, 45))).toBe(true);
    expect(isRunDue(schedule, utc(3, 20))).toBe(false);
  });

  it("the tick floor fires on every tick", () => {
    const schedule = { frequency: "every_n_minutes" as const, n: TICK_MINUTES };
    for (let m = 0; m < 60; m += TICK_MINUTES) {
      expect(isRunDue(schedule, utc(9, m))).toBe(true);
    }
  });

  it("fires on the same minutes in every hour of the day", () => {
    const schedule = { frequency: "every_n_minutes" as const, n: 20 };
    for (let h = 0; h < 24; h++) {
      expect(isRunDue(schedule, utc(h, 0))).toBe(true);
      expect(isRunDue(schedule, utc(h, 20))).toBe(true);
      expect(isRunDue(schedule, utc(h, 40))).toBe(true);
      expect(isRunDue(schedule, utc(h, 25))).toBe(false);
    }
  });

  it("n=60 collapses to once an hour", () => {
    const schedule = { frequency: "every_n_minutes" as const, n: 60 };
    expect(isRunDue(schedule, utc(3, 0))).toBe(true);
    for (let m = TICK_MINUTES; m < 60; m += TICK_MINUTES) {
      expect(isRunDue(schedule, utc(3, m))).toBe(false);
    }
  });

  it("an interval the tick never visits is refused, not approximated", () => {
    // n=7 would match minutes 0,7,14,... but a 5-minute tick only visits
    // 0,5,10,... — the intersection is :00 and :35, which is neither "every 7
    // minutes" nor anything a user would predict.
    expect(isRunDue({ frequency: "every_n_minutes", n: 7 }, utc(3, 0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_minutes", n: 7 }, utc(3, 35))).toBe(false);
    expect(isRunDue({ frequency: "every_n_minutes", n: 0 }, utc(3, 0))).toBe(false);
    expect(isRunDue({ frequency: "every_n_minutes", n: 90 }, utc(3, 0))).toBe(false);
  });
});

describe("isValidIntervalMinutes", () => {
  it("accepts whole multiples of the tick up to an hour", () => {
    for (let n = TICK_MINUTES; n <= 60; n += TICK_MINUTES) {
      expect(isValidIntervalMinutes(n)).toBe(true);
    }
  });

  it("rejects anything the tick can't express", () => {
    expect(isValidIntervalMinutes(0)).toBe(false);
    expect(isValidIntervalMinutes(1)).toBe(false); // below the tick floor
    expect(isValidIntervalMinutes(7)).toBe(false); // not a tick multiple
    expect(isValidIntervalMinutes(61)).toBe(false);
    expect(isValidIntervalMinutes(90)).toBe(false); // over an hour
    expect(isValidIntervalMinutes(12.5)).toBe(false);
    expect(isValidIntervalMinutes(-15)).toBe(false);
    expect(isValidIntervalMinutes("15")).toBe(false);
    expect(isValidIntervalMinutes(null)).toBe(false);
  });
});

describe("intervalWrapGapMinutes", () => {
  it("is null when the interval divides the hour evenly", () => {
    for (const n of [5, 10, 15, 20, 30, 60]) {
      expect(intervalWrapGapMinutes(n)).toBeNull();
    }
  });

  it("reports the short final gap for a non-divisor", () => {
    expect(intervalWrapGapMinutes(25)).toBe(10); // :00 :25 :50 -> 10 to next :00
    expect(intervalWrapGapMinutes(35)).toBe(25); // :00 :35       -> 25
    expect(intervalWrapGapMinutes(40)).toBe(20); // :00 :40       -> 20
    expect(intervalWrapGapMinutes(45)).toBe(15); // :00 :45       -> 15
    expect(intervalWrapGapMinutes(50)).toBe(10); // :00 :50       -> 10
    expect(intervalWrapGapMinutes(55)).toBe(5);  // :00 :55       -> 5
  });

  it("agrees with what isRunDue actually does", () => {
    for (const n of [25, 35, 40, 45, 50, 55]) {
      const schedule = { frequency: "every_n_minutes" as const, n };
      const fires: number[] = [];
      for (let m = 0; m < 60; m += TICK_MINUTES) {
        if (isRunDue(schedule, utc(4, m))) fires.push(m);
      }
      expect(60 - fires[fires.length - 1]).toBe(intervalWrapGapMinutes(n));
    }
  });

  it("is null for an invalid interval rather than throwing", () => {
    expect(intervalWrapGapMinutes(7)).toBeNull();
    expect(intervalWrapGapMinutes(0)).toBeNull();
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
    expect(parseSchedule({ frequency: "every_n_minutes", n: 15 })).toEqual({
      frequency: "every_n_minutes",
      n: 15,
    });
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

  it("rejects an interval the tick can't express, so the settings PATCH 400s", () => {
    expect(parseSchedule({ frequency: "every_n_minutes" })).toBeNull(); // missing n
    expect(parseSchedule({ frequency: "every_n_minutes", n: 7 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_minutes", n: 1 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_minutes", n: 0 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_minutes", n: 120 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_minutes", n: "15" })).toBeNull();
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

  it("renders every_n_minutes, collapsing n=60 to 'hourly'", () => {
    expect(describeSchedule({ frequency: "every_n_minutes", n: 5 })).toBe("every 5 minutes");
    expect(describeSchedule({ frequency: "every_n_minutes", n: 25 })).toBe("every 25 minutes");
    expect(describeSchedule({ frequency: "every_n_minutes", n: 60 })).toBe("hourly");
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
