# HANDOFF — Grower Access Claims Sprint (2026-07-02)

## What shipped
Backend data path that materialises `app_metadata.consignor_ids` (uuid array) and
`app_metadata.is_internal` (boolean) into every user's `auth.users.raw_app_meta_data`,
plus the per-user freshness stamp the mm-data-hub companion guard will consume.

- **Migration** `supabase/migrations/00015_grower_access_claims.sql`
  (applied to project `uqzfkhsdyeokwnkpcxui` as version `20260702012209 grower_access_claims`):
  - `public.claim_freshness (user_id pk → auth.users on delete cascade, claims_updated_at)` —
    RLS enabled, table privileges revoked from `anon`/`authenticated`, zero client-applicable
    policies (the single `claim_freshness_service_role_read` policy is a no-op for advisor
    hygiene; `service_role` has `bypassrls`).
  - `private.resolve_consignor_ids(uuid)`, `private.resolve_is_internal(uuid)`,
    `private.sync_user_claims(uuid)`, `private.sync_all_claims()`,
    `private.handle_claims_change()` (trigger fn), `public.rpc_sync_all_claims()`
    (service-role-only PostgREST wrapper). All SECURITY DEFINER, `search_path=''`,
    EXECUTE revoked from `public`/`anon`/`authenticated`.
  - Statement-level AFTER INSERT/UPDATE/DELETE triggers on `module_access`, `hub_users`,
    `farms`. No trigger on `ft_entities` — the FreshTrack entity sync ends with a bulk
    resync call instead.
- **TypeScript**: `lib/freshtrack/sync/entitySync.ts` — `syncEntities()` now ends with
  `rpc_sync_all_claims` (throws loudly if the resync fails, so a stale-claims state is
  a visible step failure, never silent).
- **Verification**: `scripts/verify_grower_claims.sql` — idempotent psql script covering
  SPRINT.md criteria 2–8 and 11–12 with disposable-test-user setup/teardown; 25
  assertions, fails loudly (`ON_ERROR_STOP` + raise). Ran end to end clean (exit 0)
  against the live project.

## Measured values (fixtures for the companion sprint)
- **AC2 consignor count**: grower_admin resolver = **32** consignor UUIDs, set-equal to the
  canonical chain (group `bffbebbe-…` Mackays Marketing → farms → ft_entities).
- **AC10 token lifetime**: measured `exp - iat` = **3600 seconds**. ⚠️ The interim TTL
  reduction to 600s described in SPRINT.md ("actioned in the dashboard at scoping") is NOT
  in effect — a fresh password-grant token measured 3600s on 2026-07-02. Re-apply
  Auth → Sessions → JWT expiry = 600 in the dashboard. Staleness is currently capped at
  60 minutes, not 10. Both current users are internal, so the hard gate
  (no external growers until the companion guard is live at both doors) still holds.
- **AC11 door probe**: grower_admin claims see 8,637 of 22,450 `raw.ft_dispatch_load` rows,
  exactly matching the superuser count filtered to that consignor set; empty claims and
  user_metadata-poison claims both return 0 rows.

## Decisions / deviations
- **AC1 "zero policies"**: after the first advisor run flagged `claim_freshness` with
  `rls_enabled_no_policy` (INFO), one SELECT policy scoped to `service_role` only was added.
  This is semantically a no-op (`service_role` bypasses RLS) and keeps the interface
  contract's real requirement — zero policies for `anon`/`authenticated`, fail closed —
  while restoring the security-advisor output to the exact pre-sprint baseline (6 findings,
  none related to this sprint). The verify script asserts "zero client-applicable policies +
  no client table privileges" accordingly.
- **Migration number**: authored as 00005 against a stale local checkout; renamed to
  **00015** on rebase (upstream had advanced to 00014). The remote DB migration record is
  timestamp-versioned (`20260702012209`) so nothing DB-side changes.
- `raw`, `core`, `semantic` schemas, existing RLS policies, and existing migration files
  untouched. Policy counts before/after: raw 10/10, core 12/12, semantic 0/0.
- Legacy scalar `consignor_id` key is never written (asserted).

## Next steps (companion sprint / ops)
1. Re-apply the 600s JWT expiry in the Supabase dashboard (see ⚠️ above).
2. mm-data-hub companion: freshness guard reading `public.claim_freshness` at both doors
   (Postgres `semantic.*` functions + Cube Cloud auth layer), rule: token `iat` <
   `claims_updated_at` → treat claims as empty/false.
3. Hard gate stands: no external grower user provisioning until the guard is live.

---

# MM-Hub Grower Portal — Session Handoff

_Captured 2026-06-06 at end of the foundation rebuild session._
_Replaces stale guidance in `PROGRESS.md` and `grower_portal/Mackays-Grower-Portal-Spec-v2.md`._

## Where this is

Branch `sprint-0-foundation` on origin, **14 commits** ahead of `main`. Every
commit gates on typecheck + lint + 17 vitest tests + `next build`. PR link:
https://github.com/mackaysmarketing/mm-hub/pull/new/sprint-0-foundation.

Prod Supabase (`mm_hub`, ref `uqzfkhsdyeokwnkpcxui`) currently has migrations
00005, 00006, 00007, 00008, and 00009 applied. Pre-launch (no grower rows yet);
the shared CRM/quoting tables (`quotes`, `retailers`, etc.) are untouched.

**Security advisors:** every MM-Hub-owned warning is closed. The 12 portal_*
SECURITY DEFINER RPC-exposure warnings are gone (helpers moved to a `private`
schema not exposed by PostgREST in 00009), and the `set_updated_at` search_path
warning is pinned. Remaining advisors are CRM-module (`quotes`/`file_uploads`
always-true INSERT) and an auth-level HaveIBeenPwned toggle — neither ours.

## What works end-to-end now

A hub admin can do the full provisioning journey through the UI:

1. **Create a grower group** at `/hub-admin/grower-groups` (name + ABN).
2. **Add RCTI recipients** (financial axis — who Mackays pays). Edit + delete
   with FK guards.
3. **Add farms** (production axis — FreshTrack entities). Assign each to a
   recipient (many-farms-per-recipient is the non-negotiable cardinality).
4. **Upload RCTI PDFs** for a recipient with metadata (RCTI ref, payment date,
   total invoiced). Edit metadata + delete + signed-URL download.
5. **Create grower users** at `/hub-admin/users` with module access scoped by:
   - Farm axis (`grower_ids`, null = all farms in group)
   - Recipient axis (`recipient_ids`, null = all recipients)
   - Menu items (server-side enforced, not just sidebar-hidden)
   - Financial access per page (toggles money visibility)
   - Capabilities (manage users, trigger sync, etc.)

A grower then signs in at the grower portal (`/dashboard`, `/sales`,
`/remittances`, etc.) and sees exactly the data they're scoped to. The Farm
Selector ("All Farms" default) appears only when they have >1 accessible farm
and persists across navigations.

## Architecture (current state)

```
grower_groups               access tenant (Mackays composes)
  ├── rcti_recipients       financial axis: who Mackays pays
  │       ↑
  │       │ recipient_id
  │       │
  │   remittances           legacy single-axis (kept for future proper sync)
  │       ↑
  │       │ recipient_id
  │   rcti_documents        on-demand PDF storage (current RCTI surface)
  │
  └── farms                 production axis: FreshTrack entities
          ↑                 (renamed from `growers`; a `growers` view aliases)
          │
          ├── ft_*          synced FreshTrack data
          ├── qa_*          QA assessments + scores + audits
          ├── documents     general grower documents
          └── remittance_line_items.farm_id  (per-line attribution)
```

## RLS is the authoritative tenant boundary

Every read path goes through Row-Level Security on the **user client**
(`@/lib/supabase/server`). The service-role admin client (`@/lib/supabase/admin`)
is confined to: cron sync handlers, hub-admin write routes (with explicit
hub_role re-checks), and grower-admin write routes (with explicit group
re-checks). Helper functions in the DB:

| Helper | Returns | Used by |
|---|---|---|
| `private.is_hub_admin()` | bool | gates admin policies + portal_is_internal |
| `private.portal_group_id()` | uuid | the user's grower_group_id |
| `private.portal_role()` | text | their grower-portal module_role |
| `private.portal_is_internal()` | bool | hub_admin OR (admin/staff) — sees all tenants |
| `private.portal_farm_ids()` | uuid[]/null | null = all farms in group, else explicit set |
| `private.portal_recipient_ids()` | uuid[]/null | null = all recipients in group, else explicit |
| `private.portal_can_see_farm(uuid)` | bool | per-farm authz check |
| `private.portal_can_see_recipient(uuid)` | bool | per-recipient authz check |
| `private.portal_can_see_remittance(uuid)` | bool | resolves through recipient |
| `private.portal_can_see_assessment(uuid)` | bool | resolves through farm |

These live in the `private` schema specifically so PostgREST doesn't expose
them as RPC. If you add a new helper, keep it in `private` for the same
reason — anything in `public` becomes callable from any signed-in client.

Storage RLS (`00007`) scopes `storage.objects` in the `documents` bucket by
path prefix matching the same `portal_can_see_*` helpers, so signed URLs from
the user client only succeed for visible paths. Defense in depth — table RLS
+ storage RLS, not a single admin-bypass.

## App-layer access context

`lib/portal-access.ts::getPortalAccessContext()` loads each request's scope:

```ts
PortalAccessContext = {
  growerGroupId, growerIds, recipientIds,    // axis scopes (concrete arrays)
  isInternal,                                 // cross-tenant
  allowedMenuItems,                           // server-side menu enforcement
  financialAccess,                            // per-page money toggle
  moduleRole, capabilities
}
```

`getGrowerFilter(ctx, requestedId?)` and `getRecipientFilter(ctx, requestedId?)`
validate any client-supplied id against the caller's concrete scope (no IDOR).
`hasMenuAccess(ctx, "Remittances")` is checked at the top of every grower
data route to 403 when the page isn't granted.

## The pieces deliberately left for later

**1. NetSuite real sync rebuild.** The cron route is gated behind
`NETSUITE_SYNC_ENABLED` — it short-circuits with `{status: "disabled"}` until
the raw export from finance is sorted. When that lands, do this work:

- Build the `rcti_imports` staging table (see the design captured in the prior
  draft of `supabase/migrations/00006_rcti_import_staging.sql` in earlier
  commits, plus the `supabase/fixtures/rcti-sample-LMB-Cooroo-2026-06-03.txt`
  reference PDF text).
- Wrap remittance line/charge writes in a Postgres function (transactional)
  to fix the non-transactional delete-then-insert that wipes line detail on
  partial failure.
- Reconcile against PDF totals (the sample arithmetic confirms
  sum-by-charge-name across origin-load detail pages).
- Populate `remittances.recipient_id` and `remittance_line_items.farm_id` so
  the financial-axis surfaces work with synced data, not just uploaded PDFs.

**2. `growers` → `farms` callers.** The 00008 view keeps existing
`.from("growers")` calls working. Future cleanup: migrate API routes and
TypeScript types to `farms` for domain clarity, then drop the view.

**3. Smoke test against prod.** The user has to do the manual auth flow.
The path: create a grower group → add a recipient → add a farm assigned to
it → upload the sample LMB Cooroo PDF → create a test grower user scoped to
that farm → sign in as them → confirm `/remittances` shows the PDF with
preview + download.

## Subtle traps recorded

**Postgres views and RLS.** Views default to `security_invoker = false`,
meaning RLS on underlying tables is evaluated as the view *owner* (typically
the postgres superuser), which BYPASSES tenant isolation entirely. Always
create views over RLS-protected tables `WITH (security_invoker = true)`.
Caught on the 00008 validation branch (the `growers` view returned 3 rows
per grower instead of 1 until I flipped the flag).

**Branch validation matters.** Three migrations this session uncovered real
bugs on the validation branch before they reached prod: the `recipient_ids`
JSONB null handling in 00005 (`jsonb_array_elements_text` choked on JSON
null), and this `security_invoker` trap in 00008. Skipping the branch-validate
step would have shipped both regressions to production.

**Cross-table refs in policies.** When a SELECT policy joins another table
(e.g. `ft_entities` matching by `freshtrack_code` against `growers`), the
join uses the SQL parser-visible table name at policy creation time, not
through a helper. Renaming the table required recreating the `ft_entities`
policy with the new join target — easy to miss.

## What's in `supabase/`

```
supabase/
  migrations/
    00001_initial_schema.sql           pre-rebuild baseline (mostly historical)
    00002_sync_config.sql              FreshTrack/NetSuite mapping config
    00003_netsuite_sync_config.sql     unverified NetSuite step mappings
    00004_farms_and_grower_admin.sql   pre-rebuild group layer (superseded)
    00005_two_axis_model_and_rls.sql   THE rebuild — applied to prod
    00006_rcti_documents.sql           on-demand PDF storage — applied
    00007_storage_rls.sql              defense-in-depth on storage.objects
    00008_rename_growers_to_farms.sql  table rename + back-compat view
    00009_private_schema_for_helpers.sql  move RLS helpers out of PostgREST
  fixtures/
    rcti-sample-LMB-Cooroo-2026-06-03.txt   extracted PDF text for future
                                            reconciliation tests
  tests/
    rls_isolation.sql                  the persona matrix as a runnable script
```

## Sprint 3 status — FreshTrack GraphQL sync

The legacy `v_power_bi_*` RDS sync was replaced with a typed GraphQL-driven
sync. **Code is complete and tested; the migration is not yet applied.**

| Layer | What's there |
|---|---|
| **Transport** | `lib/freshtrack-graphql.ts` — server-only GraphQL client with two-layer token cache, singleflight re-auth, error classification by `errors[0].code` (NOT HTTP status — verified live), typed exception hierarchy, exp backoff for 5xx, Retry-After honour. |
| **Queries + types** | `lib/freshtrack/queries.ts` — hand-typed (no codegen) for entities, dispatchLoads, pallets, harvestLoads, chargesApplied, orderItems. |
| **Classifier** | `lib/freshtrack/classify.ts` — maps EntityNode → `skip`/`rcti_recipient`/`farm`/`self_paid_farm`/`orphan_farm`. Pure function, mirrors `private.ft_classify_entity` SQL. |
| **Sync helpers** | `lib/freshtrack/sync/{cursor,logger,windowing}.ts` — per-step watermark cursor in `ft_sync_state`, per-step `sync_logs` writer, sliding-window paginator with binary-shrink-on-overflow. |
| **Per-step sync** | `lib/freshtrack/sync/{entity,dispatch,pallet,harvest,charge}Sync.ts` — each upserts into the target `ft_*` table on `freshtrack_id`. |
| **Orchestrator** | `app/api/cron/sync-freshtrack/route.ts` — gated behind `FRESHTRACK_GRAPHQL_SYNC_ENABLED`, claims via `private.claim_freshtrack_run()`, 270s in-handler budget with per-step caps, releases on finish. |
| **Catalogue picker** | `GET /api/hub-admin/freshtrack-catalogue` + tabbed FarmDialog. Super admin picks from synced `ft_entities` to provision farms. Recipient picker for NS deferred until the NS sync exists. |
| **Migration 00010** | Additive: new columns on existing `ft_*` + `farms` + `rcti_recipients`, 4 new tables, helper functions in `private`. ✅ Branch-validated 2026-06-08 (5-category classifier + concurrency claim/release tested) and applied to prod. |
| **Migration 00011** | Adds the missing `grower_groups.code` UNIQUE constraint (live prod had been built without it via the 338fcbd hotfix). Idempotent — no-op on fresh DBs that have it from 00005. Applied to prod. |
| **Branch validation** | ✅ Done. The pattern: spin up Supabase branch → apply 00010 → run sanity SQL → tear down → apply same SQL to prod. |

**To bring it online**: see [`docs/FRESHTRACK-SYNC-RUNBOOK.md`](docs/FRESHTRACK-SYNC-RUNBOOK.md).
Full multi-agent design that produced this is captured in
[`docs/FRESHTRACK-GRAPHQL-DISCOVERY.md`](docs/FRESHTRACK-GRAPHQL-DISCOVERY.md).

## Quick health check

The fastest smoke test against prod is `GET /api/health` — it returns
`{status:"ok", db:"ok"}` (200) when the app process is up and Supabase
answers a trivial query, or `{status:"degraded", db:"error", db_error: ...}`
(503) otherwise. No auth required, no tenant data touched. Use this for
Vercel monitoring, or as the first "is anything answering?" probe before
walking the full smoke test.

## Two things the user owns next

1. **Confirm the rebuild works end-to-end** by doing the manual smoke test
   above. If anything is off, file it as a new issue.
2. **NetSuite raw export.** Get a non-empty sample of the raw RCTI data file
   that lands on SFTP alongside the PDF. With that, the proper consolidation
   pipeline is unblockable.

## Cron tick drift — process scheduler (2026-08-13)

`/api/cron/processes` decides due-ness by **elapsed time since the last
completed run**, never by the wall-clock minute. See `SPRINT.md` for the full
sprint record.

**What was wrong.** `isRunDue()` matched the current minute against exact slots
(`minute % n === 0` for `every_n_minutes`, `minute === 0` for `hourly`). Vercel
does not guarantee a cron lands on the minute, and :00 and :30 are its busiest
slots, so those invocations arrived late, failed the match, and silently did
nothing while still returning 200. Over 5 days of `process_runs`, against an
expected 120 per slot: `:00 -> 70`, `:30 -> 76`, every other slot 119–120. The
hourly report lost the entire hour whenever its one slot drifted to :01.

**What replaced it.** `isRunDue(schedule, nowUtc, lastRunAt)` — a process is due
when `now - lastRunAt >= interval - DUE_TOLERANCE_MS`. The cron route looks up
`lastRunAt` per process from `process_runs`. `daily` is anchored to a Brisbane
*hour* (never a minute): due once the day's anchor has passed and no run has
happened since.

Things worth knowing before changing this:

| Thing | Why it is the way it is |
|---|---|
| `DUE_TOLERANCE_MS` is 150s (half the tick), not the 30s the brief named | At 30s, any tick more than 30s late drops the *next* one — the bug relocated, not fixed. 150s is chosen for **symmetry** (equal drift margin either side of a boundary), *not* because it is the largest safe value — that would be 259s. Pinned by `isRunDue — the 30s tolerance cascade`. |
| `TERMINAL_RUN_STATUSES` includes `failed` | Due-ness is "did it run", not "did it succeed". `registry.ts` marks a run `failed` when a *single* order's FreshTrack write fails, and the report throws on any non-2xx from Resend. Keying on success meant a 5-minute retry storm and duplicate emails against an API with no idempotency key. A failure retries on the next *interval*. |
| Due-ness is re-checked after `claimRun` succeeds | Vercel cron delivery is at-least-once. Two invocations a second apart both read the same `lastRunAt` and both judge themselves due; the UNIQUE index only excludes runs overlapping *in time*, so the loser would run once the winner released. The loser's row is deleted, not released — releasing it would advance `lastRunAt`. |
| The clock is read per process, and rows are ordered by `key` | `now` captured once before the loop meant a slow first process could get the second judged against a clock staler than the tolerance — a dropped run, the original bug through a different door. |
| The cron loop wraps each process in try/catch | Previously a throw from one process 500'd the route and the other never ran on that tick. |

**Two things this does NOT guarantee**, both pinned by tests — see SPRINT.md
"Known limits": a tick more than 150s late still drops the run after it, and the
report's real invariant is a 57m30s minimum gap rather than once per clock hour.

**Verify in production 24h after deploy** (Supabase SQL editor, `data_hub`):

```sql
select extract(minute from started_at)::int as minute_of_hour, count(*) runs
from public.process_runs
where process_key = 'consignor_auto_assign'
  and started_at > now() - interval '24 hours'
group by 1 order by 1;
```

Expect **12 dominant rows, each close to 24**, plus a few stragglers at `:01`,
`:31` and so on — a drifted tick now runs and records at the minute it actually
arrived, which is the whole point. Read it as "no slot is badly short", not as
"exactly 12 rows": `:00` and `:30` were at 58% and 63% of expected before this
fix. Then the report, expecting 24:

```sql
select count(*) from public.process_runs
where process_key = 'consignor_auto_assign_report'
  and started_at > now() - interval '24 hours';
```

## MULTIPLE consignor header — Stage A (2026-08-13)

An order whose crops resolve to **more than one** consignor now takes a header
consignor of `MULTIPLE` (FreshTrack entity code `MULTI`) instead of being
skipped as `ambiguous_multi_crop`. It is a true statement about the order, and
it stops a wrong single consignor propagating to the loads that inherit from it.

**Stage B — per-crop consignor on each LOAD — is NOT built.** An order with the
MULTIPLE header still needs its loads split by hand. Find them with:

```sql
select target_ref, consignee_name, after->>'consignor_codes' as codes, created_at
from process_actions
where process_key = 'consignor_auto_assign'
  and status = 'applied' and after->>'reason' = 'multiple'
order by created_at desc;
```

### The distinction that matters

`matchOrder` used to return one `ambiguous` result for two different things.
They are now separate, and conflating them again would be a real bug:

| Outcome | Meaning | Behaviour |
|---|---|---|
| `multiple` | Every crop resolved, they disagree. We can name all the consignors. | Header set to MULTIPLE |
| `unmapped_crop` | A crop has **no rule at all** — its consignor is unknown. | Still a human decision |

Unmapped **wins** over multiple when both are true. MULTIPLE asserts "we know
them all"; an unmapped crop breaks that claim, so an order with mapped Papaya,
mapped Passionfruit and an unmapped third crop is an unknown, not a multiple.

### Off switch — no deploy needed

The runner treats an absent config key as "not configured" and falls straight
back to the old behaviour, skipping as `multiple_not_configured`:

```sql
update process_definitions
set config = config - 'multiple_consignor_ft_id'
where key = 'consignor_auto_assign';
```

### Why Stage B was deferred, and what it would need

Verified against the live FreshTrack API before building:

- `dispatchLoads(filterOrderId:)`, `DispatchLoadNode.consignorId` and
  `bulkUpdateDispatchLoads({stateId, consignorId, carrierId})` all exist — the
  narrow bulk input avoids the ~20-required-field read-modify-write that
  `updateDispatchLoad` would force. **Stage B is possible whenever wanted.**
- **But `orderItems.dispatchLoadId` is null on every line of every order
  sampled across all six live states (0 of 48).** The line→load link is not
  used in this tenant, so crop-per-load is only knowable from PALLETS, which
  exist only after packing — i.e. late.
- Of 25 packed loads sampled, **all 25 carried exactly one crop**, so the
  signal is clean once it exists.
- 5 of 14 multi-load orders already have differing load consignors, set by
  hand — e.g. order 5024965 (`5019613` APPEC / `5019599` SQBRL).

### Why the header write is safe

Sampled all 10 blank-consignor orders in a 400-order window: 9 had all-blank
load consignors, and the single exception was a **cancelled** order, a state
`assignable_state_codes` already excludes. So for everything this process acts
on, a blank order consignor implies blank load consignors — the header write
never overwrites a load value, and `applyConsignor` still refuses any order
whose consignor is already set.

**Ids:** `multiple_consignor_ft_id` is the CONSIGNOR ROLE id
(`019ff95b-e763-b796-2f35-26c24b5ea7a2`), not the entity id
(`019ff95b-e75a-…`). The two differ, the rules table stores role ids too, and
mixing them up fails silently — the write succeeds and points at nothing usable.

## Retailer Price Verification tool (2026-08-19)

New Tools entry at `/tools/price-verification`, sitting alongside Auto FT Consignor
Update. Verifies FreshTrack order line prices against the weekly Coles and
Woolworths quote extracts. **It never writes to FreshTrack** — there is no
mutation in this feature's code or in anything it calls.

### The decision that shaped everything: Postgres, not live GraphQL

The sprint doc assumed the tool would walk live GraphQL, and carried a whole
acceptance criterion about pacing, timeouts and checkpoint/resume because both
MCP routes to FreshTrack hung after bursts of ~6 queries during scoping.

That turned out to be unnecessary for the tool itself. The nightly sync
(`orderSync.ts` / `orderItemSync.ts`, migrations 00010/00016) already lands every
field the comparison needs, and it has already resolved each trap the sprint
warned about:

| Sprint trap | Already handled by |
|---|---|
| `entity.consigneeId`, not entity `id` | `ft_orders.consignee_ft_id` to `ft_entities.consignee_freshtrack_id` |
| orders are versioned; use the highest | `ft_orders.latest_order_version_ft_id`; items only exist for that version |
| `filterArchived: true` hangs the server | `ft_orders.is_archived`, already synced |
| datetime offsets / local-day bucketing | `scheduled_delivery_on`, bucketed to Brisbane here |

So a whole week of orders is **three indexed queries instead of ~2N GraphQL
calls**. The rate-limit problem is removed rather than mitigated.

**The cost is coverage, and it is not silent.** The sync only holds orders from
about **2026-06-30** onward. `checkCoverage()` runs before every verification and
records its verdict on the run; a window the sync does not hold is reported as
"not synced", never as a reassuring "0 orders found".

For historical weeks there is `scripts/price-verification-backtest.ts`, which
walks live GraphQL with the full discipline (>=1.1s pacing, 15s per-request
timeout, backoff via the shared transport, checkpoint after every order).
**This script has not been run** — it needs `FT_GRAPHQL_EMAIL` /
`FT_GRAPHQL_PASSWORD`, which were not available in the build session. It is the
only unexercised code in the feature.

### Facts confirmed against the real files and the live database

- **Coles** `.xlsx`: 62 rows to 434 per-day lines, 6 DCs, 0 parse warnings.
  Excel serial 46119 = 2026-04-07, as the sprint said.
- **Woolworths** Weekly PQF: an HTML page from the Salesforce partner hub named
  `.xls`. It opens with a `<script>` block, not `<table>`, so byte-sniffing is
  not enough — SheetJS's HTML path reads it. 16 rows to 112 lines, 5 DCs.
- **Woolworths prices are per weekday, not flat.** The sheet has a two-row
  header where the Price and Quantity blocks *repeat the same seven dated
  column labels*. Matching dated headers alone reads quantities as prices; the
  group row ("Price" / "Quantity") is what disambiguates. Both retailers are
  normalised to one line per **article x DC x day**, so a mid-week price change
  is honoured rather than averaged away.
- **Retailer is detected from header content, never the filename** — these files
  get renamed constantly.

### Two findings that change how the report should be read

1. **Most orders carry no line price until they are Invoiced.** Live counts:
   Invoiced 1475/1633 lines priced (~90%), Ordered 280/1067 (~26%), WWG- Load
   Moved 0/466. `raw_json` has no price either, so this is FreshTrack, not a
   sync mapping bug. Such lines report `no_order_price` — explicitly *not* a
   mismatch — and an order where every line is unpriced reads "no line on this
   order carries a price yet". Practically, verification bites at Invoiced.

2. **The "Approved?" flag cannot be a hard filter.** In the 7-13 Apr Coles
   sample only **5 of 13** Coles Parkinson rows are `Checked`, yet the papaya and
   passionfruit rows carry real prices the orders were placed against. Treating
   unapproved rows as "no quote" (the sprint's proposed D4) would leave most of
   Parkinson unverifiable and would not reproduce the manually-verified 19/19
   baseline. So it is a **setting**, `unapproved_quotes`, defaulting to `use`.
   A blank price is separate and always means "cannot verify".

### Verified end-to-end against live data

Real Coles orders for 2026-08-03..09 (83 orders / 190 lines pulled from
`ft_orders` + `ft_order_items`), against a quote built from the actual prices
with **two articles deliberately perturbed**:

```
Orders in window: 83
  verified 24 · mismatched 13 · partial 0 · no usable quote 44 · skipped 2 · unmapped 0
Lines checked: 189 — matched 96, mismatched 14, not checkable 79
5 order(s) flagged as duplicates
mismatched articles: ["2512240","5512451"]   <- exactly the two that were perturbed
```

- The six buckets partition the total exactly (24+13+0+44+2+0 = 83).
- No false positives and no misses: only the injected errors were flagged.
- The 5 duplicates are all **Coles Melbourne** parallel Ordered/Invoiced series —
  precisely the EDI re-import pattern the sprint predicted. All members are
  reported; the later ones carry `is_duplicate` so nothing is double-counted.
- CSV: 191 rows = 189 line rows + one row each for the two Cancelled orders,
  which appear with their reason rather than being dropped.

### Access control (the admin section)

New generic `tool_access` table keyed `(tool_key, user_id)`, plus
`lib/tools/registry.ts` marking which tools are gated. The rule, in
`lib/tools/access.ts` so no route can drift from it:

- hub_admin — always allowed, and the only role that can grant
- holds a `tool_access` row — allowed
- internal (admin/staff) and the tool is not gated — allowed
- anyone else — denied

`retailer_price_verification` is gated (quote pricing is commercially
sensitive); `consignor_auto_assign` is not, so **who can see the existing tool
did not change**. The Tools index now filters to what the caller can actually
open. Grants are managed on the tool's own **Access** tab, which lists only
Mackays-internal accounts — granting a grower-side account would create a row
the page then refuses.

### Not built, and why

- **Writing "Price Verified" back to FreshTrack (sprint D3).** That order state
  does not exist in FreshTrack yet and which transitions are legal is undecided.
  `price_verification_settings.write_back_state_ft_id` is reserved and nothing
  reads it. When built it needs an explicit apply flag plus an allowlist of
  transitions, mirroring how `consignor_auto_assign` gates its writes.
- **Coles DPO9745 (D5).** No confirmed entity. Seeded with `entity_code = NULL`;
  its orders report as "DC not mapped" rather than being guessed or dropped.
- **WOW Sydney RDC 1986 = Minchinbury (D6).** Mapped to WOWMI on the sprint's
  assumption, flagged in the row's `notes` as unconfirmed with the WOW team.
- Note the sprint's `ADE9541 -> COLAD` alternative: **no COLAD entity exists** in
  `ft_entities`. Mapped to COLSA, which is the active one.

### Design-language divergence (flagged, not acted on)

`docs/mackays-ui-kit.md` (in grower-portal) specifies Tailwind v4 with no config
file and shadcn on Base UI. mm-hub ships Tailwind v3 with `tailwind.config.ts`
and Radix-based shadcn, with its own named brand tokens (`forest`, `bark`,
`soil`, `sand`, `warmwhite`, `canopy`, `harvest`, `blaze`). This tool follows
**mm-hub's shipped conventions** so it sits beside the consignor tool without
looking foreign. Reconciling mm-hub to the kit is a separate piece of work.

### Files

- `supabase/migrations/00023_retailer_price_verification.sql` — applied to
  `uqzfkhsdyeokwnkpcxui`. Additive only; no existing table touched.
- `lib/priceVerification/` — `parseQuote` (both formats), `compare` (pure engine,
  no I/O, shared by app and backtest), `dbOrderSource`, `graphqlOrderSource`,
  `run`, `report`, `settings`, `types`.
- `lib/tools/` — `registry.ts`, `access.ts`.
- `app/api/tools/price-verification/` — quotes, runs, settings, dc-map, access.
- `app/(grower-portal)/tools/price-verification/` — page + client.
- `scripts/price-verification-backtest.ts` — historical windows (unrun).
- 68 new tests. Full suite 297 passing, `tsc --noEmit` clean, `next lint` clean,
  `next build` clean.
