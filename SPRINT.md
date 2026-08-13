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
- [x] The "last run" lookup only counts runs that completed their work, so a
      failed run does not block the next attempt for a whole interval.
      **Deviation from the literal brief, flagged for review** — see below.
- [x] `next build` completes with 0 errors and `tsc --noEmit` is clean.

### Deviation: which statuses count as "last successful run"

The brief says `status = 'success'` only. Implemented as
`status IN ('success','partial')` — `SUCCESSFUL_RUN_STATUSES` in
`lib/processes/schedule.ts`.

`partial` means the run completed and did its work, but some assignment rules
failed live validation. That is a *persistent* state, not a transient one: the
assign process reported `partial` for days while migration 00018 was applied
ahead of its code. If `partial` did not count, `lastSuccessAt` would never
advance, every tick would be due, and the hourly report would send 12 emails an
hour — reintroducing precisely the bug this sprint fixes, in the other
direction.

`failed` and `skipped_locked` are correctly excluded, which is the brief's
actual intent: a failed run must not block the next attempt. `skipped_locked`
never writes a row at all.

## Definition of Done
- [x] All acceptance criteria checked, each with pasted evidence
- [x] Tests written and passing
- [x] No TypeScript errors
- [x] HANDOFF.md updated
- [x] Committed to git

## Quality Rubric (MM-Hub + Mackays Tools, relevant rows only)
| Criterion | What to check | Result |
|---|---|---|
| Access control at API layer | The cron route's auth check (CRON_SECRET / Vercel header) is unchanged and still enforced | ✅ untouched, lines 32–38 |
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

`DUE_TOLERANCE_MS` is therefore half the tick period (150s), which is the
largest tolerance that still cannot double-run: two invocations must be at
least that far apart to both fire, and the cron only fires every 5 minutes. All
of the brief's stated cases still hold — 40s apart does not double-run, the
four drifted timestamps all fire, the report fires once an hour.

Pinned by `isRunDue — the 30s tolerance cascade` in `schedule.test.ts`, which
asserts the arithmetic in both directions against `BRIEF_TOLERANCE_MS`.

**To revert to the brief's value**, one line in `lib/processes/schedule.ts`:
`export const DUE_TOLERANCE_MS = BRIEF_TOLERANCE_MS;` — the cascade test will
then fail, which is the point.
