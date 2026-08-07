/**
 * Pure schedule-due logic for the ticked process cron (app/api/cron/processes).
 *
 * Brisbane is UTC+10 year-round (Queensland does not observe DST), so the
 * offset is a fixed constant rather than something requiring a timezone
 * library — deliberately not pulling in date-fns/luxon/dayjs for this.
 *
 * GRANULARITY. The physical cron in vercel.json ticks every TICK_MINUTES, and
 * a schedule can never fire more often than that tick. TICK_MINUTES here and
 * the cron expression there are ONE setting expressed in two files that no
 * test can join up — if you change the /api/cron/processes interval in
 * vercel.json, change this constant in the same commit. A mismatch is silent:
 * schedules simply never become due at the minutes the tick no longer visits.
 */

/**
 * Must equal the /api/cron/processes interval in vercel.json (every 5 minutes).
 * Also the floor and the step for a custom interval: an every-N-minutes
 * schedule is only expressible if the tick actually visits minute N.
 */
export const TICK_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 60;

const BRISBANE_OFFSET_HOURS = 10;

export type ProcessSchedule =
  | { frequency: "every_n_minutes"; n: number }
  | { frequency: "hourly" }
  | { frequency: "every_n_hours"; n: number }
  | { frequency: "daily"; at_hour_brisbane: number };

export function brisbaneHour(nowUtc: Date): number {
  return (nowUtc.getUTCHours() + BRISBANE_OFFSET_HOURS) % 24;
}

/**
 * Brisbane's offset is a whole number of hours, so the minute-past-the-hour is
 * identical in UTC and Brisbane. Named for the intent, not the arithmetic.
 */
export function brisbaneMinute(nowUtc: Date): number {
  return nowUtc.getUTCMinutes();
}

/** Is `n` a usable custom interval — a whole multiple of the tick, up to an hour? */
export function isValidIntervalMinutes(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= TICK_MINUTES &&
    n <= MAX_INTERVAL_MINUTES &&
    n % TICK_MINUTES === 0
  );
}

/**
 * Minutes between this interval's LAST fire of one hour and its first of the
 * next, when that gap isn't simply `n`. Matching is `minute % n`, so the
 * counter resets at :00 and a non-divisor of 60 (25, 35, 40, 45, 50, 55) ends
 * each hour short: n=25 fires at :00 :25 :50, then waits only 10 minutes.
 * Returns null when the interval divides 60 evenly and the cadence is uniform.
 * Callers surface this rather than silently shipping an uneven schedule.
 */
export function intervalWrapGapMinutes(n: number): number | null {
  if (!isValidIntervalMinutes(n) || 60 % n === 0) return null;
  // Largest multiple of n strictly below 60 — the hour's final fire.
  const lastFire = Math.floor(59 / n) * n;
  return 60 - lastFire;
}

/**
 * Is `nowUtc` a valid tick for this schedule?
 *
 * Every branch below is minute-aware. Before the tick moved from hourly to
 * every TICK_MINUTES, "hourly" could return true unconditionally because a
 * tick WAS an hour — left that way, it would now fire 12 times an hour. The
 * `minute === 0` guards on the hour-based shapes are what keeps the schedules
 * that were already stored in process_definitions.config meaning what they
 * meant before this change.
 */
export function isRunDue(schedule: ProcessSchedule, nowUtc: Date): boolean {
  const hour = brisbaneHour(nowUtc);
  const minute = brisbaneMinute(nowUtc);
  switch (schedule.frequency) {
    case "every_n_minutes":
      if (!isValidIntervalMinutes(schedule.n)) return false;
      return minute % schedule.n === 0;
    case "hourly":
      return minute === 0;
    case "every_n_hours": {
      const n = schedule.n;
      if (!Number.isInteger(n) || n <= 0) return false;
      return minute === 0 && hour % n === 0;
    }
    case "daily":
      return minute === 0 && hour === schedule.at_hour_brisbane;
    default:
      return false;
  }
}

/** Human-readable rendering of a schedule — admin UI copy and email reports. */
export function describeSchedule(schedule: ProcessSchedule): string {
  switch (schedule.frequency) {
    case "every_n_minutes":
      return schedule.n === 60 ? "hourly" : `every ${schedule.n} minutes`;
    case "hourly":
      return "hourly";
    case "every_n_hours":
      return schedule.n === 1 ? "hourly" : `every ${schedule.n} hours`;
    case "daily": {
      const h = schedule.at_hour_brisbane;
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const suffix = h < 12 ? "am" : "pm";
      return `daily at ${h12}${suffix} Brisbane time`;
    }
  }
}

/** Narrow an arbitrary jsonb value into a ProcessSchedule, or null if malformed. */
export function parseSchedule(raw: unknown): ProcessSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // Rejected at the door rather than in isRunDue: an interval the tick never
  // visits (7, or 3 under a 5-minute tick) would otherwise be accepted by the
  // settings PATCH and then fire at the intersection of the two — n=7 on a
  // 5-minute tick means :00 and :35, which is neither what was asked for nor
  // anything a user would predict. Better a 400 than a schedule that lies.
  if (obj.frequency === "every_n_minutes" && isValidIntervalMinutes(obj.n)) {
    return { frequency: "every_n_minutes", n: obj.n };
  }
  if (obj.frequency === "hourly") return { frequency: "hourly" };
  if (obj.frequency === "every_n_hours" && typeof obj.n === "number") {
    return { frequency: "every_n_hours", n: obj.n };
  }
  if (
    obj.frequency === "daily" &&
    typeof obj.at_hour_brisbane === "number" &&
    obj.at_hour_brisbane >= 0 &&
    obj.at_hour_brisbane <= 23
  ) {
    return { frequency: "daily", at_hour_brisbane: obj.at_hour_brisbane };
  }
  return null;
}
