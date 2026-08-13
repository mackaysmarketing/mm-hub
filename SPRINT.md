# Sprint: Cron tick drift — process scheduler drops :00 and :30 slots
Date: 2026-08-13
Repo: mm-hub

## Scope
Replace exact wall-clock slot matching in `isRunDue()`
(`lib/processes/schedule.ts`) with elapsed-time "is it due" logic, so a cron
invocation that arrives late still runs the processes it should. Nothing else
about the consignor allocation logic changes.

Business reason: orders must reach consignors as fast as possible so they
appear in the ripening facilities' FreshTrack distributor portal. Dropped ticks
currently double the worst-case allocation latency from 5 minutes to 10, about
19 times a day.

## Confirmed cause (verified from code before any change)

`lib/processes/schedule.ts`, pre-change:

```
82:  const minute = brisbaneMinute(nowUtc);
86:      return minute % schedule.n === 0;      // every_n_minutes
88:      return minute === 0;                    // hourly
```

called from `app/api/cron/processes/route.ts:70` with the raw invocation clock:

```
70:    const due = isRunDue(schedule ?? { frequency: "hourly" }, now);
```

An invocation at 23:01:14 yields `minute = 1`; `1 % 5 === 1` → not due → the
route records `ran: false` and returns 200. The endpoint was hit and did
nothing, which is why the Vercel logs show 200s with no corresponding
`process_runs` row. `hourly` has a single slot, so a tick drifting to :01 costs
the whole hour.

Reproduced independently over 5 days of `process_runs`, expected 120 per slot:

```
 :00 -> 70    :05 -> 120   :10 -> 119   :15 -> 120
 :20 -> 120   :25 -> 120   :30 -> 76    :35 -> 120
 :40 -> 119   :45 -> 120   :50 -> 120   :55 -> 120
```

Provenance note: those minute guards were added earlier the same day, in
`feat(tools): custom run interval`. Before that, `hourly` returned `true`
unconditionally, so the failure mode was "runs 12x too often" rather than
"silently drops". One brittle rule replaced another; elapsed time is the
correct answer to both.

## Acceptance Criteria
- [x] A process is due when (now - last successful started_at) >= its
      configured interval, minus a tolerance. The wall-clock minute is never
      used to decide whether a process runs.
      **Tolerance is 150s, not the 30s specified — deviation, see below.**
- [x] Unit test: feed a synthetic sequence of invocation timestamps covering
      on-time ticks and drifted ticks at :01:14, :31:02, :00:47 and :05:31.
      Assert consignor_auto_assign fires on every one of them, and
      consignor_auto_assign_report fires exactly once per hour.
- [x] Unit test: a gap in invocations (no tick for 12 minutes) causes each
      process to fire exactly once on the next tick, not once per missed slot.
      The report must not send two emails to catch up.
- [x] Unit test: two invocations 40 seconds apart do not both run the 5-minute
      process.
- [x] The "last run" lookup counts every run that reached a terminal status, so
      a failed run retries on the next interval rather than being wedged.
      **Weaker than the brief's wording, deliberately** — see below.
- [x] Two cron invocations delivered concurrently cannot both run a process:
      due-ness is re-checked after the claim succeeds (`registry.ts`), and the
      loser's claimed row is deleted rather than released.
- [x] The clock is read per process, and processes are iterated in a
      deterministic order, so a slow first process cannot cause the second to
      be judged against a stale `now`.
- [x] `next build` completes with 0 errors and `tsc --noEmit` is clean.

### Deviation: due-ness keys off "did it run", not "did it succeed"

The brief says `status = 'success'` only. Implemented as
`status IN ('success','partial','failed')` — `TERMINAL_RUN_STATUSES` in
`lib/processes/schedule.ts`.

An earlier version of this sprint used `('success','partial')`, reasoning only
about `partial`. **Adversarial review found that carve-out was on the wrong
axis and shipped a retry storm.** At tick cadence, "a failure does not block the
next attempt" means "retried every 5 minutes, forever, with no backoff":

- `registry.ts:65-69` sets `failed` whenever `actions_failed > 0`, and
  `consignorAssign/index.ts:272` increments that for a **single** order
  FreshTrack rejects. One permanently-rejected order would make an hourly
  process run 12× an hour and hammer FreshTrack at 12× its configured rate.
- The report throws on any non-2xx from Resend (`lib/resend.ts:51-56`), and the
  send carries no idempotency key. A timeout on a message Resend *accepted*
  would re-send 5 minutes later, and again — directly against the acceptance
  criterion "the report must not send two emails".

Both are this same bug pointing the other way: a run that happened not counting
as having happened. A terminal status therefore restarts the interval, so a
failure retries **on the next interval** rather than the next tick. That is a
weaker reading of the brief's criterion than its wording, and a deliberate one:
the intent was "don't wedge the process", which is satisfied.

`running` is excluded (still in flight; runner.ts's 15-minute reaper moves a
killed one to `failed`), and `skipped_locked` never writes a row.

## Definition of Done
- [x] All acceptance criteria checked — evidence below
- [x] Tests written and passing — `vitest run`: **16 files, 225 tests passed**
- [x] No TypeScript errors — `tsc --noEmit` exits 0, no diagnostics
- [x] `next lint` — "✔ No ESLint warnings or errors"
- [x] `next build` — "✓ Compiled successfully", full route table emitted
- [x] Independent adversarial review run; findings triaged below
- [x] HANDOFF.md updated
- [x] Committed to git

Not verified: live rendering. `.env.local` on this machine has no Supabase
credentials, so `npm run dev` 500s in middleware on every route before reaching
a page. Production confirmation is the 24-hour query in HANDOFF.md.

## Independent review (Step 4)

An adversarial evaluator ran the gates itself and audited the diff. It confirmed
the gates, the removal of the wall clock (zero executable hits in
`lib/processes/`, `app/api/cron/`, `app/api/processes/`), the daily-anchor
arithmetic across UTC/month/year rollovers, and the report's single-email
catch-up traced through the real code path.

Fixed in response:

| # | Finding | Fix |
|---|---|---|
| F1/F2 | `('success','partial')` caused a 5-minute retry storm for any failing run — including one FreshTrack-rejected order, or a Resend timeout on an accepted message | `TERMINAL_RUN_STATUSES` — due-ness keys off "did it run" |
| F3 | Due-ness read before the claim; two at-least-once deliveries could both run | Post-claim re-check + `discardRun()` |
| F4 | `now` captured once before the loop; process order nondeterministic | Clock read per process; `.order("key")` |
| F6 | "Largest tolerance that cannot double-run" was false (it is 259s); the test asserting it was tautological | Claim replaced with the symmetry argument; real test written |
| F9 | `every_n_hours` with `n <= 0` or non-integer parsed, then silently never ran | `parseSchedule` rejects it |
| F11 | `as unknown as string[]` cast at the `.in()` call site | Removed |
| F12 | Doc errors: wrong line ref, "expect 12 rows", unevidenced DoD | Corrected here and in HANDOFF.md |

Accepted as known limits rather than fixed — see below: F5 (cascade raised, not
removed), F10 (clock skew), F8 (no route-level test).

## Quality Rubric (MM-Hub + Mackays Tools, relevant rows only)
| Criterion | What to check | Result |
|---|---|---|
| Access control at API layer | The cron route's auth check (CRON_SECRET / Vercel header) is unchanged and still enforced | ✅ byte-identical in the diff, `route.ts:52-57` |
| Supabase RLS | No RLS policy weakened; no new table | ✅ no migration in this sprint |
| Vercel syd1 region | No config change that shifts deployment out of Sydney | ✅ `vercel.json` regions untouched |
| FreshTrack GraphQL | No change to query shape or the 45/3 day discovery window | ✅ `consignorAssign/` untouched |
| Automation safety | The apply-mode process keeps its existing stop conditions and idempotency | ✅ runner claim/release and guards untouched |
| No secrets in code | Nothing new hardcoded | ✅ |
| Error states handled | A failure in one process does not prevent the other from running on the same tick | ✅ fixed — per-process try/catch added, see below |

## Goal Condition
The process scheduler decides due-ness by elapsed time since the last
successful run, never by the wall-clock minute. Evidence required:
1. Diff of the scheduling function showing slot matching removed
2. Test suite passing, including drifted timestamps at :01:14, :31:02, :00:47,
   :05:31 — 5-minute process fires on all four, hourly report once per hour
3. Test proving a 12-minute gap causes exactly one catch-up run per process
4. Test proving two invocations 40 seconds apart do not both run the 5-minute
   process
5. `next build` 0 errors and `tsc --noEmit` clean

## Out of Scope
- Consignor matching rules, assignable_state_codes, discovery_horizon_days,
  discovery_lookback_days
- The email template or recipient for the report
- The vercel.json cron cadence itself (leave it at every 5 minutes)
- Any change to process_definitions rows in production
- Anything in the grower.* surface

## Deviation: the tolerance is 150s, not 30s

**The 30-second tolerance the brief specifies does not fix the bug — it moves
it one slot later.** Found by writing the sequence test, not by reasoning.

Elapsed time is measured from when the last run actually *started*, so a late
run drags its whole window late. At 30s, any tick more than 30s late causes the
**next** tick to be dropped:

| Last run | Next tick | Elapsed | 30s threshold (270s) | 150s threshold |
|---|---|---|---|---|
| :31:02 | :35:11 | 249s | **dropped** | fires |
| :00:47 | :05:14 | 267s | **dropped** | fires |

Your Vercel logs show :00 and :30 drifting by 14–75s. Every drift over 30s
would cost the following slot, at roughly the same daily rate as the bug being
fixed — so the reported symptom would have moved from ":00 and :30 are short"
to ":05 and :35 are short", with the business impact unchanged.

`DUE_TOLERANCE_MS` is therefore half the tick period (150s). **Not** because it
is "the largest tolerance that cannot double-run" — an earlier draft of this
document claimed that and it is false: the double-run boundary is 259s, since
two ticks 40s apart both fire only once the threshold drops below 40s
(300 − 260). The property that actually justifies 150s is **symmetry**: a tick
fires at k intervals when elapsed ≥ k·300 − 150, so 150s of drift is absorbed
on *each* side of every boundary — 150s of room before an early tick
double-runs, 150s before a late one drops its successor. Any other value trades
one margin for the other.

**This raises the tolerated drift from 30s to 150s; it does not remove the
cascade.** A tick more than 150s late still drops the run after it. Vercel has
shown 14–75s in these logs, so it is comfortably inside — but nothing enforces
that, and the recurrence signature is identical to the original bug (HTTP 200,
`ran: false`, no error). Recorded under Known limits below.

Pinned by `isRunDue — the 30s tolerance cascade` in `schedule.test.ts`, which
asserts the arithmetic in both directions against `BRIEF_TOLERANCE_MS`,
including a test that the 259s boundary claim stays refuted.

**To revert to the brief's value**, one line in `lib/processes/schedule.ts`:
`export const DUE_TOLERANCE_MS = BRIEF_TOLERANCE_MS;` — the cascade test will
then fail, which is the point.

## Known limits (recorded, not fixed)

| # | Limit | Why it is acceptable for now |
|---|---|---|
| F5 | A tick more than 150s late still drops the run after it. The recurrence signature is the original bug's: HTTP 200, `ran: false`, no error, visible only in timing data. | Vercel drift in these logs is 14–75s. Nothing enforces that ceiling and nothing monitors it — the 24h query in HANDOFF.md is the detector. Removing it entirely means tracking a notional due-time separate from actual run time. |
| F5b | The report's guarantee is a **57m30s minimum gap**, not "once per clock hour". A tick ≥~170s late can put two sends in one clock hour. | Pinned by `isRunDue — the report's real spacing invariant`. Docs no longer claim otherwise. |
| F8 | All scheduler tests drive `isRunDue` through a test-local `replay()` helper that *models* the cron loop. Nothing tests `getLastRunAt`, the status filter, the try/catch, or the loop itself. `find app -name "*.test.ts"` returns zero — the repo has no route-level test harness at all. | Consistent with the codebase, which tests pure logic and leaves I/O orchestration untested. Establishing a Supabase-mocking harness is its own piece of work. |
| F10 | A `lastRunAt` in the future (Postgres vs Vercel clock skew) silently halves the effective rate until real time catches up. Not clamped, not logged. | Cannot double-run, self-heals, and `lastRunAt` is in the route's JSON response for diagnosis. Tested both directions. |
| F11b | Two definitions of "last run" now coexist: the scheduler's (terminal statuses, ordered by `started_at`) and the report period boundary's (`status = 'success'`, ordered by `completed_at`, `queryReportData.ts:112-119`). | Benign today — the report is only ever `success` or `failed`. Will diverge if the report ever reports `partial`. |
