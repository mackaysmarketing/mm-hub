# CLAUDE.md

Working agreements for this repo. Tooling and issue-tracking conventions live in
[`AGENTS.md`](AGENTS.md) — read both.

## Non-negotiables

### Scheduled work is due on elapsed time, never the wall clock

Scheduled work is due based on elapsed time since its last successful run.
Never on the wall-clock minute. Cron invocations arrive late and that must not
drop a run.

This applies to anything that decides "should this run now" — `isRunDue()` in
`lib/processes/schedule.ts` today, and any future scheduler. Concretely:

- Never branch on `getMinutes()` / `getUTCMinutes()`, `minute % n === 0`, or
  any equivalent slot check, to decide whether work runs.
- Compare `now - lastRunAt` against the configured interval, with a tolerance
  wide enough to absorb platform drift between consecutive ticks. A tolerance
  narrower than the drift relocates the bug rather than fixing it.
- Time-of-day schedules may anchor to an hour, but must then ask "has a run
  happened since that anchor", not "is the clock exactly on it".

**Why this is a rule and not a preference.** A scheduler that matched exact
minute slots passed code review and ran in production for days looking correct.
The drift only showed up in timing data: over 5 days it silently dropped 40% of
the `:00` slot and 37% of `:30`, returning HTTP 200 each time with no run and no
error. Nothing in the code, the logs, or the tests said anything was wrong.
See `SPRINT.md` and the "Cron tick drift" section of `HANDOFF.md`.

**The check that catches it next time:** a test that feeds deliberately drifted
invocation timestamps — not just on-the-minute ones — and asserts every one of
them fires. Sequence tests, not single-instant tests: the drift bug and the
tolerance-cascade bug that replaced it were both only visible across a run of
consecutive ticks.
