/**
 * Pure schedule-due logic for the ticked process cron (app/api/cron/processes).
 *
 * Brisbane is UTC+10 year-round (Queensland does not observe DST), so the
 * offset is a fixed constant rather than something requiring a timezone
 * library — deliberately not pulling in date-fns/luxon/dayjs for this.
 *
 * The tick cron itself runs hourly (vercel.json), so schedule matching is
 * done at HOUR granularity — a schedule finer than hourly isn't meaningful
 * until the physical cron itself ticks faster.
 */

const BRISBANE_OFFSET_HOURS = 10;

export type ProcessSchedule =
  | { frequency: "hourly" }
  | { frequency: "every_n_hours"; n: number }
  | { frequency: "daily"; at_hour_brisbane: number };

export function brisbaneHour(nowUtc: Date): number {
  return (nowUtc.getUTCHours() + BRISBANE_OFFSET_HOURS) % 24;
}

/**
 * Is `nowUtc` a valid tick for this schedule? Ticks are hourly, so this
 * answers "is the current hour a due hour" — it does not need minute
 * precision.
 */
export function isRunDue(schedule: ProcessSchedule, nowUtc: Date): boolean {
  const hour = brisbaneHour(nowUtc);
  switch (schedule.frequency) {
    case "hourly":
      return true;
    case "every_n_hours": {
      const n = schedule.n;
      if (!Number.isInteger(n) || n <= 0) return false;
      return hour % n === 0;
    }
    case "daily":
      return hour === schedule.at_hour_brisbane;
    default:
      return false;
  }
}

/** Narrow an arbitrary jsonb value into a ProcessSchedule, or null if malformed. */
export function parseSchedule(raw: unknown): ProcessSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
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
