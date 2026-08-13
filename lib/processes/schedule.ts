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

const BRISBANE_OFFSET_MS = BRISBANE_OFFSET_HOURS * 3_600_000;

export function brisbaneHour(nowUtc: Date): number {
  return (nowUtc.getUTCHours() + BRISBANE_OFFSET_HOURS) % 24;
}

/**
 * How early a tick may be relative to the exact interval and still count as
 * "due". Cron invocations do not land on the second, so comparing elapsed time
 * to the interval exactly would drop a run whenever the platform was a moment
 * slow.
 *
 * WHY HALF THE TICK PERIOD AND NOT THE 30s THE SPRINT BRIEF NAMED. Elapsed
 * time is measured from when the last run actually STARTED, so a late run
 * pushes the whole window late. With a 30s tolerance and a tick cadence equal
 * to the interval, any tick more than 30s late causes the NEXT one to be
 * dropped: a run at :31:02 followed by a tick at :35:11 is 249s apart, inside
 * the 270s threshold. That does not fix the reported bug, it moves it one slot
 * later — and since :00 and :30 drift by 14-75s in the Vercel logs, at roughly
 * the same daily rate. See `isRunDue — the 30s tolerance cascade` in the
 * tests, which pins that arithmetic.
 *
 * WHY HALF specifically. Not "the largest tolerance that cannot double-run" —
 * that would be 259s, since two ticks 40s apart both fire only once the
 * threshold drops below 40s (300 - 260). Half the tick period is the value
 * that centres the decision boundary: a tick fires at k intervals when elapsed
 * >= k*300 - 150, so the same 150s of drift is absorbed in BOTH directions
 * around each boundary — an early tick has 150s of room before it double-runs,
 * a late one 150s before it drops the next. Any other value trades one margin
 * for the other.
 *
 * This raises the drift the scheduler tolerates from 30s to 150s; it does not
 * make it unbounded. A tick more than 150s late still drops the run after it.
 * That is a known limit, pinned by tests and recorded in SPRINT.md — not a
 * claim that the cascade is gone.
 */
export const DUE_TOLERANCE_MS = (TICK_MINUTES * 60_000) / 2;

/** The value the sprint brief specified, kept for the test that shows why it fails. */
export const BRIEF_TOLERANCE_MS = 30_000;

/**
 * Run statuses that mean "this process RAN" — the axis due-ness is measured on.
 * Deliberately not "succeeded".
 *
 * The sprint brief asked for last-*successful*-run, so a failure would not
 * block the next attempt for a whole interval. Implemented literally that
 * produces a retry storm, because at tick cadence "not blocked" means "retried
 * every 5 minutes, forever, with no backoff":
 *
 *  - `failed` is set whenever actions_failed > 0 (registry.ts), which
 *    consignorAssign increments for a SINGLE order FreshTrack rejects. One
 *    permanently-rejected order would make an hourly process run 12x an hour.
 *  - The report throws on any non-2xx from Resend (lib/resend.ts), and that
 *    send has no idempotency key. A timeout on a message Resend actually
 *    accepted would re-send 5 minutes later, and again, and again — against an
 *    acceptance criterion that says the report must not send two emails.
 *
 * Both are the drift bug pointing the other way: a run that happened not
 * counting as having happened. A terminal status means the work was attempted,
 * so the interval restarts and a failure retries on the next INTERVAL rather
 * than the next tick. `running` is excluded (still in flight; the 15-minute
 * reaper in runner.ts moves a killed one to `failed`), and `skipped_locked`
 * never writes a row at all.
 */
export const TERMINAL_RUN_STATUSES = ["success", "partial", "failed"] as const;

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

// intervalWrapGapMinutes() lived here. It described the uneven cadence that
// `minute % n` matching produced at the top of each hour — n=25 firing at :00
// :25 :50 and then waiting only 10 minutes. Elapsed-time due-ness has no slots
// and no hour boundary to reset at, so every interval is now uniform by
// construction and there is nothing to warn about. Removed with the UI hint it
// fed (SPRINT.md, 2026-08-13).

/**
 * The fixed gap between runs, in ms, or null for a shape anchored to a time of
 * day (daily) or one that is malformed.
 */
export function scheduleIntervalMs(schedule: ProcessSchedule): number | null {
  switch (schedule.frequency) {
    case "every_n_minutes":
      return isValidIntervalMinutes(schedule.n) ? schedule.n * 60_000 : null;
    case "hourly":
      return 3_600_000;
    case "every_n_hours":
      return Number.isInteger(schedule.n) && schedule.n > 0
        ? schedule.n * 3_600_000
        : null;
    case "daily":
      return null;
  }
}

/**
 * The most recent instant at which Brisbane's wall clock read `atHour`:00 —
 * today's occurrence if it has already passed, otherwise yesterday's.
 */
function mostRecentDailyAnchor(atHour: number, nowUtc: Date): Date {
  // Shift into "Brisbane as if it were UTC" so the UTC getters read local parts.
  const shifted = new Date(nowUtc.getTime() + BRISBANE_OFFSET_MS);
  const anchor = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      atHour,
      0,
      0,
      0
    )
  );
  if (anchor.getTime() > shifted.getTime()) {
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }
  return new Date(anchor.getTime() - BRISBANE_OFFSET_MS);
}

/**
 * Should this process run on the invocation happening at `nowUtc`?
 *
 * DUE-NESS IS ELAPSED TIME, NEVER THE WALL-CLOCK MINUTE. The previous
 * implementation matched the current minute against exact slots
 * (`minute % n === 0`, `minute === 0`). Vercel does not guarantee a cron lands
 * on the minute, and :00 and :30 are its busiest slots, so those invocations
 * arrived a second to a minute late, failed the match, and silently did
 * nothing — the endpoint returned 200 with no run. Over 5 days that cost 40%
 * of the :00 slot and 37% of :30, and every hour whose tick drifted to :01
 * lost the hourly report entirely.
 *
 * `lastRunAt` is the started_at of the most recent run that reached a terminal
 * status (see TERMINAL_RUN_STATUSES) — "when did this last run", not "when did
 * it last succeed". Null means it has never run, in which case it is due
 * immediately.
 *
 * A late tick still fires, because elapsed time only grows. A gap fires ONCE
 * on the next tick rather than once per missed slot, because this answers "is
 * it due now", not "how many slots were skipped" — so the report cannot send a
 * backlog of catch-up emails.
 *
 * A `lastRunAt` in the future (clock skew between Postgres, which stamps
 * started_at, and the Vercel runtime, which supplies nowUtc) yields a negative
 * elapsed and simply reads as not-due until real time catches up. It cannot
 * cause a double run.
 */
export function isRunDue(
  schedule: ProcessSchedule,
  nowUtc: Date,
  lastRunAt: Date | null
): boolean {
  if (schedule.frequency === "daily") {
    const atHour = schedule.at_hour_brisbane;
    if (!Number.isInteger(atHour) || atHour < 0 || atHour > 23) return false;
    // Anchored to an hour, never to a minute: a tick at 07:01 still fires,
    // because what matters is that no run has happened since 07:00.
    const anchor = mostRecentDailyAnchor(atHour, nowUtc);
    return lastRunAt === null || lastRunAt.getTime() < anchor.getTime();
  }

  const interval = scheduleIntervalMs(schedule);
  if (interval === null) return false; // malformed — never run rather than guess
  if (lastRunAt === null) return true;
  return nowUtc.getTime() - lastRunAt.getTime() >= interval - DUE_TOLERANCE_MS;
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
  // n must be validated HERE, not left to isRunDue. A shape that parses but can
  // never be due is the silent-never-runs failure this scheduler exists to
  // eliminate: {frequency:"every_n_hours", n:0} would pass the settings PATCH,
  // store cleanly, and then never fire — and the route's "no valid schedule ->
  // default to hourly" fallback only catches a NULL parse, not this.
  if (
    obj.frequency === "every_n_hours" &&
    typeof obj.n === "number" &&
    Number.isInteger(obj.n) &&
    obj.n > 0
  ) {
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
