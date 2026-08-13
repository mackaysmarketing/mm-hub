import { describe, it, expect } from "vitest";
import {
  brisbaneHour,
  isRunDue,
  parseSchedule,
  describeSchedule,
  isValidIntervalMinutes,
  scheduleIntervalMs,
  DUE_TOLERANCE_MS,
  BRIEF_TOLERANCE_MS,
  TERMINAL_RUN_STATUSES,
  TICK_MINUTES,
  type ProcessSchedule,
} from "./schedule";

// Brisbane = UTC+10, no DST — 00:00 UTC is 10:00 Brisbane.
function utc(hour: number, minute = 0, second = 0): Date {
  return new Date(Date.UTC(2026, 6, 30, hour, minute, second));
}

const EVERY_5 = { frequency: "every_n_minutes", n: 5 } as const;
const HOURLY = { frequency: "hourly" } as const;

/**
 * Replays a sequence of cron invocations through isRunDue exactly as
 * app/api/cron/processes does: each invocation asks "am I due", and a run that
 * fires becomes the new lastSuccessAt for the next one. Returns the
 * invocations that actually ran.
 */
function replay(schedule: ProcessSchedule, ticks: Date[], lastSuccessAt: Date | null = null) {
  const fired: Date[] = [];
  let last = lastSuccessAt;
  for (const tick of ticks) {
    if (isRunDue(schedule, tick, last)) {
      fired.push(tick);
      last = tick;
    }
  }
  return fired;
}

const hhmmss = (d: Date) => d.toISOString().slice(11, 19);

describe("brisbaneHour", () => {
  it("adds the fixed 10h offset", () => {
    expect(brisbaneHour(utc(0))).toBe(10);
    expect(brisbaneHour(utc(14))).toBe(0);
  });

  it("wraps past midnight", () => {
    expect(brisbaneHour(utc(20))).toBe(6); // 20 + 10 = 30 -> 6
  });
});

describe("isRunDue — the drift regression", () => {
  /**
   * The bug this sprint fixes. The scheduler matched the wall-clock minute
   * against exact slots, so a Vercel invocation that arrived at :01:14 instead
   * of :00:00 failed the match and silently ran nothing while still returning
   * 200. Over 5 days of production process_runs, against an expected 120 per
   * slot: :00 -> 70 and :30 -> 76, every other slot 119-120.
   *
   * The four timestamps below are real drifted invocations taken from the
   * Vercel runtime logs for 2026-08-12.
   */
  const DRIFTED = [
    { label: ":01:14", at: utc(23, 1, 14), prev: utc(22, 55, 12) },
    { label: ":31:02", at: utc(22, 31, 2), prev: utc(22, 25, 14) },
    { label: ":00:47", at: utc(22, 0, 47), prev: utc(21, 55, 9) },
    { label: ":05:31", at: utc(21, 5, 31), prev: utc(21, 0, 47) },
  ];

  it.each(DRIFTED)(
    "the 5-minute process fires on a tick drifting to $label",
    ({ at, prev }) => {
      expect(isRunDue(EVERY_5, at, prev)).toBe(true);
    }
  );

  it("pins which of these the old slot matching actually dropped", () => {
    // Only drift that crosses a minute boundary was lost. :01:14 and :31:02
    // fail `minute % 5 === 0`; :00:47 and :05:31 are sub-minute drift that the
    // old check happened to tolerate — which is why production showed 70 and 76
    // at those slots rather than zero.
    expect(utc(23, 1, 14).getUTCMinutes() % 5).not.toBe(0);
    expect(utc(22, 31, 2).getUTCMinutes() % 5).not.toBe(0);
    expect(utc(22, 0, 47).getUTCMinutes() % 5).toBe(0);
    expect(utc(21, 5, 31).getUTCMinutes() % 5).toBe(0);
  });

  it("fires on every tick of a mixed on-time and drifted sequence", () => {
    const ticks = [
      utc(21, 0, 47), // drifted
      utc(21, 5, 31), // drifted
      utc(21, 10, 14),
      utc(21, 15, 9),
      utc(21, 20, 12),
      utc(21, 25, 14),
      utc(21, 31, 2), // drifted past :30
      utc(21, 35, 11), // only 249s after the one above — the cascade case
    ];
    expect(replay(EVERY_5, ticks).map(hhmmss)).toEqual(ticks.map(hhmmss));
  });

  it("the hourly report fires exactly once per hour across the same drift", () => {
    // Ticks every 5 minutes for 3 hours, with :00 drifting to :01 in hour 2 —
    // the case that used to lose the whole hour.
    const ticks: Date[] = [];
    for (let h = 20; h < 23; h++) {
      for (let m = 0; m < 60; m += 5) {
        const drift = m === 0 && h === 21 ? 74 : 14; // :00 -> :01:14 in hour 21
        ticks.push(new Date(utc(h, m).getTime() + drift * 1000));
      }
    }
    const fired = replay(HOURLY, ticks, utc(19, 0, 12));
    expect(fired).toHaveLength(3);
    expect(fired.map((d) => d.getUTCHours())).toEqual([20, 21, 22]);
    // and the drifted hour is the :01:14 one, not a skipped hour
    expect(hhmmss(fired[1])).toBe("21:01:14");
  });
});

describe("isRunDue — catch-up after a gap", () => {
  it("a 12-minute gap fires the 5-minute process exactly once, not once per missed slot", () => {
    // No invocation between 10:00 and 10:12 — the :05 and :10 slots are gone.
    const ticks = [utc(10, 0, 12), utc(10, 12, 30), utc(10, 15, 14)];
    const fired = replay(EVERY_5, ticks);

    // One run per invocation. Slot-counting would have produced 5 (two missed
    // slots replayed as catch-up on top of the three real ticks).
    expect(fired).toHaveLength(3);
    expect(fired.map(hhmmss)).toEqual(["10:00:12", "10:12:30", "10:15:14"]);

    // The gap tick itself fires exactly one run, not one per slot it spans.
    expect(replay(EVERY_5, [utc(10, 12, 30)], utc(10, 0, 12))).toHaveLength(1);
  });

  it("a long gap fires the hourly report once, so it cannot send a backlog of emails", () => {
    // Five hours with no invocation at all, then ticks resume.
    const ticks = [utc(15, 0, 20), utc(15, 5, 14), utc(15, 10, 9)];
    const fired = replay(HOURLY, ticks, utc(10, 0, 11));
    expect(fired.map(hhmmss)).toEqual(["15:00:20"]);
    expect(fired).toHaveLength(1); // NOT five catch-up sends
  });

  it("a process that has never run is due immediately", () => {
    expect(isRunDue(EVERY_5, utc(3, 17, 41), null)).toBe(true);
    expect(isRunDue(HOURLY, utc(3, 17, 41), null)).toBe(true);
  });
});

describe("isRunDue — no double runs", () => {
  it("two invocations 40 seconds apart do not both run the 5-minute process", () => {
    const first = utc(9, 0, 14);
    const second = new Date(first.getTime() + 40_000);
    expect(isRunDue(EVERY_5, first, utc(8, 55, 12))).toBe(true);
    expect(isRunDue(EVERY_5, second, first)).toBe(false);
  });

  it("a burst of rapid invocations produces exactly one run", () => {
    const ticks = [0, 20, 40, 60, 90, 120].map(
      (s) => new Date(utc(9, 0, 14).getTime() + s * 1000)
    );
    expect(replay(EVERY_5, ticks, utc(8, 55, 12))).toHaveLength(1);
  });

  it("the tolerance lets a tick be early, but never by more than itself", () => {
    const last = utc(9, 0, 0);
    const interval = 5 * 60_000;
    const justInside = new Date(last.getTime() + interval - DUE_TOLERANCE_MS);
    const justOutside = new Date(justInside.getTime() - 1_000);
    expect(isRunDue(EVERY_5, justInside, last)).toBe(true);
    expect(isRunDue(EVERY_5, justOutside, last)).toBe(false);
  });

});

describe("isRunDue — the 30s tolerance cascade", () => {
  /**
   * Why DUE_TOLERANCE_MS is half the tick period rather than the 30s the
   * sprint brief named. Elapsed time runs from when the last run STARTED, so a
   * late run drags its whole window late. At 30s, any tick later than 30s
   * causes the NEXT one to be dropped — the reported bug relocated one slot,
   * not fixed, since :00 and :30 drift by 14-75s in the Vercel logs.
   */
  const FIVE_MIN_MS = 5 * 60_000;

  it.each([
    { label: "run at :31:02, tick at :35:11", last: utc(21, 31, 2), tick: utc(21, 35, 11) },
    { label: "run at :00:47, tick at :05:14", last: utc(9, 0, 47), tick: utc(9, 5, 14) },
  ])("30s would have dropped $label; the chosen tolerance does not", ({ last, tick }) => {
    const elapsed = tick.getTime() - last.getTime();
    expect(elapsed).toBeLessThan(FIVE_MIN_MS - BRIEF_TOLERANCE_MS); // dropped at 30s
    expect(elapsed).toBeGreaterThanOrEqual(FIVE_MIN_MS - DUE_TOLERANCE_MS); // kept now
    expect(isRunDue(EVERY_5, tick, last)).toBe(true);
  });

  it("the chosen tolerance centres the decision boundary, absorbing equal drift both ways", () => {
    // NOT "the largest tolerance that cannot double-run" — that is 259s, since
    // two ticks 40s apart both fire once the threshold falls below 40s. The
    // property that actually justifies 150s is symmetry: the same drift is
    // absorbed on each side of a boundary.
    const tickMs = TICK_MINUTES * 60_000;
    const last = utc(9, 0, 0);
    const earlyRoom = tickMs - DUE_TOLERANCE_MS; // elapsed at which a tick fires
    const lateRoom = DUE_TOLERANCE_MS; // lateness before the next is dropped
    expect(earlyRoom).toBe(lateRoom);

    // Exactly at the boundary it fires; one second earlier it does not.
    expect(isRunDue(EVERY_5, new Date(last.getTime() + earlyRoom), last)).toBe(true);
    expect(isRunDue(EVERY_5, new Date(last.getTime() + earlyRoom - 1000), last)).toBe(false);
  });

  it("the 259s boundary the 'largest' claim would have implied", () => {
    // Documents why that claim was wrong, so it cannot be reinstated by
    // someone reasoning about it afresh.
    const tickMs = TICK_MINUTES * 60_000;
    expect(tickMs - 259_000).toBeGreaterThan(40_000); // 41s: 40s apart still safe
    expect(tickMs - 260_000).toBeLessThanOrEqual(40_000); // 40s: double-run
    expect(DUE_TOLERANCE_MS).toBeLessThan(259_000);
    expect(DUE_TOLERANCE_MS).toBeGreaterThan(BRIEF_TOLERANCE_MS);
  });

  it("a tick later than the tolerance still drops the next run — a known limit, not a fix", () => {
    // 150s raises the drift the scheduler absorbs from 30s; it does not make it
    // unbounded. Pinned so the docs cannot drift into claiming otherwise.
    const veryLate = utc(21, 33, 20); // 200s late
    const nextTick = utc(21, 35, 11);
    expect(nextTick.getTime() - veryLate.getTime()).toBeLessThan(
      5 * 60_000 - DUE_TOLERANCE_MS
    );
    expect(isRunDue(EVERY_5, nextTick, veryLate)).toBe(false);
  });

  it("still refuses the 40-second double-run the brief asked about", () => {
    const first = utc(9, 0, 14);
    expect(isRunDue(EVERY_5, new Date(first.getTime() + 40_000), first)).toBe(false);
  });
});

describe("isRunDue — the wall clock is never consulted", () => {
  it("due-ness depends only on elapsed time, not on where the minute falls", () => {
    // The same 5-minute gap at every minute-of-hour must give the same answer.
    for (let m = 0; m < 60; m++) {
      const last = utc(4, m, 33);
      const next = new Date(last.getTime() + 5 * 60_000);
      expect(isRunDue(EVERY_5, next, last)).toBe(true);
      expect(isRunDue(EVERY_5, new Date(last.getTime() + 60_000), last)).toBe(false);
    }
  });

  it("every_n_hours is elapsed hours, at any minute", () => {
    const schedule = { frequency: "every_n_hours", n: 4 } as const;
    const last = utc(2, 37, 5);
    expect(isRunDue(schedule, new Date(last.getTime() + 4 * 3_600_000), last)).toBe(true);
    expect(isRunDue(schedule, new Date(last.getTime() + 3 * 3_600_000), last)).toBe(false);
  });
});

describe("isRunDue — daily", () => {
  // daily is anchored to a Brisbane HOUR (never a minute): it is due once the
  // day's anchor has passed and no run has happened since.
  const AT_7AM = { frequency: "daily", at_hour_brisbane: 7 } as const;
  // Brisbane 07:00 == 21:00 UTC the previous day.
  const anchorUtc = new Date(Date.UTC(2026, 6, 29, 21, 0, 0));

  it("fires on the first tick at or after the anchor", () => {
    expect(isRunDue(AT_7AM, anchorUtc, new Date(anchorUtc.getTime() - 3_600_000))).toBe(true);
  });

  it("still fires when the tick drifts past the hour", () => {
    const drifted = new Date(anchorUtc.getTime() + 74_000); // 07:01:14 Brisbane
    expect(isRunDue(AT_7AM, drifted, new Date(anchorUtc.getTime() - 3_600_000))).toBe(true);
  });

  it("does not fire twice in a day", () => {
    const ranAt = new Date(anchorUtc.getTime() + 14_000);
    for (const offset of [40_000, 3_600_000, 12 * 3_600_000]) {
      expect(isRunDue(AT_7AM, new Date(ranAt.getTime() + offset), ranAt)).toBe(false);
    }
  });

  it("fires again the next day", () => {
    const ranAt = new Date(anchorUtc.getTime() + 14_000);
    expect(isRunDue(AT_7AM, new Date(anchorUtc.getTime() + 86_400_000 + 14_000), ranAt)).toBe(true);
  });

  it("does not fire before the day's anchor", () => {
    const yesterdayRun = new Date(anchorUtc.getTime() - 86_400_000 + 14_000);
    const beforeAnchor = new Date(anchorUtc.getTime() - 3_600_000);
    expect(isRunDue(AT_7AM, beforeAnchor, yesterdayRun)).toBe(false);
  });

  it("rejects an out-of-range hour rather than throwing", () => {
    expect(isRunDue({ frequency: "daily", at_hour_brisbane: 24 }, utc(3), null)).toBe(false);
    expect(isRunDue({ frequency: "daily", at_hour_brisbane: -1 }, utc(3), null)).toBe(false);
  });
});

describe("isRunDue — the report's real spacing invariant", () => {
  /**
   * SPRINT.md and HANDOFF.md previously said the report "fires once an hour"
   * flatly. What the code actually guarantees is a minimum spacing of
   * interval - tolerance = 57m30s. Inside the drift Vercel has actually shown
   * (<=75s) those coincide, but a tick late enough can put two sends in one
   * clock hour. Stated here so the guarantee is not overclaimed.
   */
  it("guarantees a 57m30s minimum gap, which is not the same as once per clock hour", () => {
    const minGap = 3_600_000 - DUE_TOLERANCE_MS;
    expect(minGap).toBe(3_450_000);

    const first = utc(12, 0, 14);
    const secondSameHour = new Date(first.getTime() + minGap); // 12:57:44
    expect(isRunDue(HOURLY, secondSameHour, first)).toBe(true);
    expect(secondSameHour.getUTCHours()).toBe(first.getUTCHours()); // same clock hour
  });

  it("but a 5-minute tick cadence keeps it to once an hour in practice", () => {
    // The 12:55 tick is 3286s after a 12:00:14 run — short of 3450s — so the
    // next send is the 13:00 tick. Two-in-an-hour needs a tick landing in the
    // 57m30s-60m window, which a 5-minute cadence only reaches when a tick is
    // more than ~150s late.
    const ticks: Date[] = [];
    for (let h = 12; h < 15; h++) {
      for (let m = 0; m < 60; m += 5) ticks.push(utc(h, m, 14));
    }
    const fired = replay(HOURLY, ticks, utc(11, 0, 14));
    expect(fired).toHaveLength(3);
    expect(fired.map((d) => d.getUTCHours())).toEqual([12, 13, 14]);
  });
});

describe("isRunDue — clock skew", () => {
  it("a lastRunAt in the future reads as not-due and cannot double-run", () => {
    // started_at is stamped by Postgres, nowUtc comes from the Vercel runtime.
    const future = new Date(utc(9, 0, 0).getTime() + 30_000);
    expect(isRunDue(EVERY_5, utc(9, 0, 0), future)).toBe(false);
    expect(isRunDue(HOURLY, utc(9, 0, 0), future)).toBe(false);
  });

  it("recovers on its own once real time passes the skew", () => {
    const future = new Date(utc(9, 0, 0).getTime() + 30_000);
    expect(isRunDue(EVERY_5, new Date(future.getTime() + 5 * 60_000), future)).toBe(true);
  });
});

describe("isRunDue — malformed schedules never run", () => {
  it("refuses an interval the tick can't express", () => {
    expect(isRunDue({ frequency: "every_n_minutes", n: 7 }, utc(3), null)).toBe(false);
    expect(isRunDue({ frequency: "every_n_minutes", n: 0 }, utc(3), null)).toBe(false);
    expect(isRunDue({ frequency: "every_n_minutes", n: 90 }, utc(3), null)).toBe(false);
  });

  it("refuses a non-positive or non-integer every_n_hours", () => {
    expect(isRunDue({ frequency: "every_n_hours", n: 0 }, utc(0), null)).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: -3 }, utc(0), null)).toBe(false);
    expect(isRunDue({ frequency: "every_n_hours", n: 1.5 }, utc(0), null)).toBe(false);
  });
});

describe("scheduleIntervalMs", () => {
  it("converts each interval shape to milliseconds", () => {
    expect(scheduleIntervalMs(EVERY_5)).toBe(300_000);
    expect(scheduleIntervalMs({ frequency: "every_n_minutes", n: 25 })).toBe(1_500_000);
    expect(scheduleIntervalMs(HOURLY)).toBe(3_600_000);
    expect(scheduleIntervalMs({ frequency: "every_n_hours", n: 4 })).toBe(14_400_000);
  });

  it("is null for daily, which is anchored to a time of day, and for garbage", () => {
    expect(scheduleIntervalMs({ frequency: "daily", at_hour_brisbane: 7 })).toBeNull();
    expect(scheduleIntervalMs({ frequency: "every_n_minutes", n: 7 })).toBeNull();
    expect(scheduleIntervalMs({ frequency: "every_n_hours", n: -1 })).toBeNull();
  });
});

describe("TERMINAL_RUN_STATUSES", () => {
  it("counts every run that happened, including failed ones", () => {
    // Due-ness is measured on "did it run", not "did it succeed". registry.ts
    // marks a run `failed` when actions_failed > 0, which consignorAssign
    // increments for a SINGLE order FreshTrack rejects — so keying on success
    // would let one bad order make an hourly process run every 5 minutes.
    expect(TERMINAL_RUN_STATUSES).toContain("success");
    expect(TERMINAL_RUN_STATUSES).toContain("partial");
    expect(TERMINAL_RUN_STATUSES).toContain("failed");
  });

  it("excludes statuses that mean the run did not happen", () => {
    expect(TERMINAL_RUN_STATUSES).not.toContain("running");
    expect(TERMINAL_RUN_STATUSES).not.toContain("skipped_locked");
  });

  it("a failing process retries on the next interval, not the next tick", () => {
    // The failure retries — it is not wedged — but at its own cadence, so a
    // report whose Resend call throws cannot re-send 12 times an hour against
    // an API with no idempotency key.
    const failedAt = utc(9, 0, 14);
    const ticks = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => utc(9, m, 14));
    expect(replay(HOURLY, ticks, failedAt)).toHaveLength(0);
    expect(isRunDue(HOURLY, utc(10, 0, 14), failedAt)).toBe(true);
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

  it("rejects an every_n_hours n that would parse but never be due", () => {
    // These used to parse cleanly and then never fire: scheduleIntervalMs
    // returns null, isRunDue returns false, and the route's "no valid schedule
    // -> hourly" fallback only catches a NULL parse. Silent-never-runs is the
    // failure class this scheduler exists to eliminate, so it is refused at the
    // door and the settings PATCH 400s.
    expect(parseSchedule({ frequency: "every_n_hours", n: 0 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_hours", n: -3 })).toBeNull();
    expect(parseSchedule({ frequency: "every_n_hours", n: 1.5 })).toBeNull();
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
