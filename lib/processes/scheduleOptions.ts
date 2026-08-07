/**
 * The mapping between a stored config.schedule and the Tools UI's schedule
 * control. Pure, and split out from client.tsx for the same reason
 * conflictAlertTemplate is split from conflictAlert: this is the part with
 * actual logic, and the part that has already gone wrong once.
 *
 * THE BUG THIS GUARDS. scheduleToOption() used to end in `return "every_4h"` —
 * a catch-all for anything that wasn't one of three presets. The seeded report
 * schedule (daily at 7am) hit it, so the dropdown displayed "Every 4 hours"
 * for a schedule that was nothing of the sort, and touching the control saved
 * that wrong preset over the real value. Custom intervals make that failure
 * far more likely, not less: most schedules are now non-preset. Hence
 * UNEDITABLE — an unrecognised schedule is shown verbatim and refused, never
 * approximated.
 */
import {
  isValidIntervalMinutes,
  MAX_INTERVAL_MINUTES,
  TICK_MINUTES,
} from "./schedule";

/** config.schedule as it arrives over the wire — shape not yet narrowed. */
export interface StoredSchedule {
  frequency: string;
  n?: number;
  at_hour_brisbane?: number;
}

/** Not a schedule of its own — picking it reveals the interval selector. */
export const CUSTOM_MINUTES = "custom_minutes";
/** A stored schedule no control on the page can express. Shown, never saved. */
export const UNEDITABLE = "uneditable";

export const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "every_4h", label: "Every 4 hours" },
  { value: "daily_midnight", label: "Daily at midnight (Brisbane)" },
  { value: CUSTOM_MINUTES, label: "Custom interval…" },
];

/**
 * 5, 10, 15 … 60. The cron tick is both the floor and the step — a schedule
 * cannot fire on a minute the tick never visits.
 */
export const INTERVAL_CHOICES = Array.from(
  { length: MAX_INTERVAL_MINUTES / TICK_MINUTES },
  (_, i) => (i + 1) * TICK_MINUTES
);

/** What "Custom interval…" starts on when switched to from a preset. */
export const DEFAULT_CUSTOM_MINUTES = 15;

export function scheduleToOption(schedule?: StoredSchedule): string {
  if (!schedule) return "every_4h";
  if (schedule.frequency === "every_n_minutes" && isValidIntervalMinutes(schedule.n)) {
    return CUSTOM_MINUTES;
  }
  if (schedule.frequency === "hourly") return "hourly";
  if (schedule.frequency === "every_n_hours" && schedule.n === 4) return "every_4h";
  if (schedule.frequency === "daily" && schedule.at_hour_brisbane === 0) {
    return "daily_midnight";
  }
  return UNEDITABLE;
}

export function optionToSchedule(option: string, minutes: number): StoredSchedule {
  if (option === "hourly") return { frequency: "hourly" };
  if (option === "daily_midnight") return { frequency: "daily", at_hour_brisbane: 0 };
  if (option === CUSTOM_MINUTES) return { frequency: "every_n_minutes", n: minutes };
  return { frequency: "every_n_hours", n: 4 };
}

/**
 * The interval the minutes selector should show: the stored one when it is a
 * usable custom interval, otherwise the default it would switch to.
 */
export function selectedMinutes(schedule?: StoredSchedule): number {
  return schedule?.frequency === "every_n_minutes" && isValidIntervalMinutes(schedule.n)
    ? schedule.n
    : DEFAULT_CUSTOM_MINUTES;
}

/** The minutes past each hour an interval actually fires on. */
export function fireMinutes(n: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 60; m += n) out.push(m);
  return out;
}
