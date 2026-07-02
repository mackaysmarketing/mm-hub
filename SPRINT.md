# Sprint: Grower Access Claims — consignor_ids resolver, materialisation, and freshness stamp
Date: 2026-07-02
Repo: mackaysmarketing/mm-hub
Supabase project: uqzfkhsdyeokwnkpcxui (shared with mm-data-hub; this sprint touches `public` and `private` only)

## Scope
Backend infrastructure only. Build the data path that populates `app_metadata.consignor_ids` (uuid array) and `app_metadata.is_internal` (boolean) in every user's `auth.users.raw_app_meta_data`, so the mm-data-hub warehouse contract (`semantic.current_consignor_ids()` / `semantic.is_internal_claim()`, verified live 2026-06) has real claims to read. Also build the per-user freshness stamp (`public.claim_freshness`) that the warehouse companion change will use to make revocation effective immediately. Deliverables: one migration (resolver functions, sync function, triggers, stamp table, grants/RLS), one small TypeScript change appending a bulk resync call to the end of the FreshTrack entity sync, and a committed verification script. No UI, no portal screens, no login pages, no new pages or routes, no changes to `raw`, `core`, or `semantic` schemas, no changes to existing RLS policies or existing migrations.

## Interface contract (cross-repo surface — names are fixed)

**Table** (the warehouse companion reads this):
```sql
public.claim_freshness (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claims_updated_at timestamptz not null
)
```
RLS enabled; zero policies for `anon`/`authenticated` (fail closed — clients can never read or write it).

**Functions** (all in `private`, SECURITY DEFINER, `SET search_path = ''`, EXECUTE revoked from `anon` and `authenticated`):
- `private.resolve_consignor_ids(p_user_id uuid) returns uuid[]`
- `private.resolve_is_internal(p_user_id uuid) returns boolean`
- `private.sync_user_claims(p_user_id uuid) returns boolean` — true if stored claims changed
- `private.sync_all_claims() returns integer` — count of users whose stored claims changed

**Resolution rule** (mirrors the existing `portal_*` semantics exactly):
1. Find the user's active `module_access` row for `module_id = 'grower-portal'`. No active row → consignor set is empty.
2. Group `g` = `config->>'grower_group_id'`. Null → empty set.
3. Farms in scope: all `farms` where `grower_group_id = g` if `module_role` in ('admin','staff','grower_admin') or `config->'grower_ids'` is null / not an array; otherwise those farms intersected with `grower_ids`.
4. Consignor set = distinct non-null `ft_entities.consignor_freshtrack_id`, joined via `farms.freshtrack_entity_uuid = ft_entities.freshtrack_id`. Include regardless of any active flags (access is ownership, not current activity). Farms with no entity link contribute nothing.
5. `is_internal` = active `hub_users` row with `hub_role = 'hub_admin'`, OR `module_role` in ('admin','staff') on the active grower-portal row.

**Sync semantics:**
- Writes `raw_app_meta_data` by merge (`||`), never replace — `provider`/`providers` keys must survive untouched.
- Writes the array key `consignor_ids` only; the legacy scalar key `consignor_id` is never written.
- A user with no access gets an explicit `consignor_ids: []` and `is_internal: false` — absent keys are not an acceptable end state for a synced user.
- `claim_freshness.claims_updated_at` advances in the same transaction as any claims change, and **only** when the computed claims differ from stored claims. No-op syncs move nothing — this is what makes the hourly FreshTrack bulk resync safe.

**Triggers:** AFTER INSERT OR UPDATE OR DELETE on `module_access`, `hub_users`, and `farms`. The handler may simply call `sync_all_claims()` (user count is tiny); the correctness requirement is only that affected users' stored claims are correct afterwards and that unchanged users' stamps do not move. No trigger on `ft_entities` (bulk upserts during sync would storm it) — instead the FreshTrack entity sync code path ends with one call to `private.sync_all_claims()`.

## Verified live-state facts (fixtures the criteria reference — confirmed 2026-07-02)
- Warehouse parser: `semantic.current_consignor_ids()` reads `request.jwt.claims → app_metadata → consignor_ids` (array of uuid strings), fail closed; `semantic.is_internal_claim()` reads `app_metadata.is_internal`. Do not modify either — companion sprint owns them.
- Consignor UUID namespace = `ft_entities.consignor_freshtrack_id` (115 of 116 distinct warehouse `consignor_id` values match it; 0 match entity or farm UUIDs).
- Grower groups: `bffbebbe-8c22-4f5d-8205-c9d481d8a956` "Mackays Marketing" (33 farms, 32 with a consignor UUID) and `b38405ee-4500-4bcb-bcdb-23d1dd9e6f3d` "Mackays" (0 farms).
- Named exclusion: farm `f625e8a0-c20f-4b52-933b-42145692d555` "Test Grower" (TEST01) has no FreshTrack entity link and must contribute nothing.
- Two auth users. Expected outcomes after first sync: the `hub_admin` (microsoft) user → `consignor_ids: []`, `is_internal: true`; the `grower_admin` (email) user (group Mackays Marketing, `grower_ids` null) → the full 32-element set, `is_internal: false`.
- Auth Hooks page: empty (nothing will overwrite materialised claims). JWT expiry: 3600s at scoping, being reduced to 600s as the interim control.

## Acceptance Criteria
Each criterion is proven by pasting the actual query/command output into the transcript. The committed script `scripts/verify_grower_claims.sql` runs criteria 2–8 and 11–12 end to end (including disposable-test-user setup and teardown) and fails loudly on any assertion.

- [x] 1. **Migration applies clean.** One new descriptively named migration (mm-hub style, no collision with the warehouse `0001`–`0022` series). `public.claim_freshness` exists with the exact contract shape (paste the column listing); RLS is enabled on it and `pg_policies` shows zero rows for it (paste both). No existing migration file edited (paste `git diff --stat` for the migrations directory showing additions only).
- [x] 2. **Resolver equals the canonical chain.** For the existing grower_admin user, `private.resolve_consignor_ids(...)` is set-equal to the canonical chain query (group farms → entities → `consignor_freshtrack_id`), cardinality > 0 (currently 32 — record the measured number). Paste the comparison query returning `set_equal = true` plus the count.
- [x] 3. **Named exclusion holds.** Paste a query showing farm `f625e8a0-...` (TEST01) is in group Mackays Marketing yet contributes no element to any resolver output.
- [x] 4. **Narrowing semantics.** Create a disposable test user (auth admin API) with `module_role = 'grower'` and `config.grower_ids` = exactly two farm UUIDs from the group: resolver returns exactly those two farms' consignor UUIDs (paste). Then show a role in ('admin','staff','grower_admin') ignores `grower_ids` (paste one case). Teardown at end (paste confirmation the user and its rows are gone).
- [x] 5. **is_internal correct and in parity.** `private.resolve_is_internal(...)` returns true for the hub_admin user and false for the grower_admin user (paste both). Inside a transaction setting `request.jwt.claims` `sub` to each user, `private.portal_is_internal()` equals `private.resolve_is_internal(auth.uid())` (paste both comparisons).
- [x] 6. **Materialisation merges, never clobbers.** After `sync_user_claims` for both real users: `raw_app_meta_data` contains `consignor_ids` (array form; key `consignor_id` absent) and `is_internal` with the expected fixture values, and the `provider`/`providers` values are byte-identical to before (paste before/after of those keys).
- [x] 7. **Stamp semantics.** (a) Flipping the test user's `module_access.active` to false results in `consignor_ids: []`, `is_internal: false`, and an advanced `claims_updated_at` (paste before/after timestamps). (b) Running `sync_all_claims()` twice consecutively: the second run returns 0 and `max(claims_updated_at)` is unchanged (paste both run outputs and the timestamp check).
- [x] 8. **Triggers fire without manual calls.** An UPDATE on `module_access`, an UPDATE on `hub_users`, an UPDATE of `farms.grower_group_id`, and a DELETE of a `module_access` row each leave the affected user's `raw_app_meta_data` correct immediately afterwards, with no explicit sync call in the test path (paste each change → read-back pair).
- [x] 9. **Bulk resync wired in.** The FreshTrack entity-sync code path ends with `private.sync_all_claims()` (paste the diff hunk), and a manual invocation returns an integer (paste).
- [x] 10. **Real token end to end.** Sign in as the disposable test user via the auth API, base64-decode the access token payload, and paste it showing `app_metadata.consignor_ids` equal to the expected two-element set and `app_metadata.is_internal: false`. Record the measured `exp - iat` (expected 600 after the interim TTL change; record whatever is measured).
- [x] 11. **Warehouse-door probes.** In a transaction with `set local role authenticated` and `request.jwt.claims` set accordingly: (a) with the grower_admin user's claims, `count(*) from raw.ft_dispatch_load` equals the superuser count filtered to `consignor_id = any(<that set>)` and is > 0 (paste both counts); (b) with `consignor_ids: []` → 0 rows; (c) with the set placed under `user_metadata` only → 0 rows (paste all three).
- [x] 12. **Security hygiene.** All new functions: `prosecdef = true` and `proconfig` includes `search_path=` (paste the `pg_proc` query); `has_function_privilege` for `anon` and `authenticated` returns false on each (paste); Supabase security advisors show no new findings versus pre-sprint (paste).
- [x] 13. **Nothing else moved.** `git diff --stat` shows no changes under warehouse-owned paths; `pg_policies` counts for `raw`/`core`/`semantic` are unchanged before vs after (paste both).
- [x] 14. **Repo health.** `tsc --noEmit` clean and `next build` completes with 0 errors (paste both tails).

## Definition of Done
- [x] All acceptance criteria checked, each with pasted evidence
- [x] `scripts/verify_grower_claims.sql` committed, idempotent, and passing end to end (full output in transcript)
- [x] No TypeScript errors
- [x] HANDOFF.md updated (include the measured consignor count from AC2 and the measured token lifetime from AC10)
- [x] Committed to git, working tree clean

## Quality Rubric (mm-hub — from references/grading-rubrics.md)
| Criterion | What to check |
|-----------|--------------|
| **Access control at API layer** | Financial data filtered server-side by role. No client-side-only role checks. (Here: claims are written only by SECURITY DEFINER paths; clients can never influence `app_metadata` or `claim_freshness`.) |
| **Three-tier access preserved** | hub_admin sees all. grower sees only their farm. staff cannot access financials. Test each role. (AC4, AC5, AC11.) |
| **Supabase RLS** | New tables have RLS policies (here: RLS enabled, deliberately zero client policies = deny). Existing RLS policies not weakened. (AC1, AC13.) |
| **MS SSO / email auth split** | hub.* uses MS SSO, grower.* uses email auth. New code respects the split. (Resolver reads `hub_users.auth_provider`-agnostic sources; no auth pattern changes.) |
| **Migration safety** | New migration doesn't break the existing schema. Rollback is possible. |
| **Financial data isolation** | Grower A cannot access Grower B's financial records under any role permutation. (AC11 negative probes are the proof.) |
| **Vercel syd1 region** | No config changes that would shift deployment out of Sydney. |

Hard blockers: access control at API layer, financial data isolation. Universal criteria apply: no secrets in code, error states handled, no TODO in the critical path, committed and clean.

## Goal Condition
```
/goal The grower access claims sprint in mm-hub is done per SPRINT.md. Prove every claim by pasting real
output: scripts/verify_grower_claims.sql runs end to end via psql against the Supabase project and every
assertion passes — paste the full output (resolver set-equality with the canonical chain, TEST01 exclusion,
grower_ids narrowing, is_internal parity with portal_is_internal, metadata merge with provider keys
preserved, consignor_ids array-only with no scalar key, stamp advancing on change, no-op sync moving
nothing, all four trigger paths, and the three warehouse-door probes with the empty-claims and
user_metadata-poison cases returning 0 rows). A real sign-in token for the disposable test user is decoded
and pasted showing app_metadata.consignor_ids equal to the expected set. `tsc --noEmit` and `next build`
are clean (tails pasted). Supabase security advisors show no new findings (pasted). Do not modify anything
in the raw, core, or semantic schemas, any existing RLS policy, or any existing migration file. Stop after
30 turns.
```

## Out of Scope
- Any UI: portal screens, login pages, admin surfaces, routes, pages.
- Multi-group access. `config.grower_group_id` stays scalar — one grower group per user (confirmed: no user will ever need farms across two or more groups).
- The warehouse-side freshness guard (changes to `semantic.current_consignor_ids()` / `semantic.is_internal_claim()`) and Cube-door freshness enforcement — companion sprint in mm-data-hub.
- Forced sign-out / session revocation on access removal (redundant once the freshness guard is live).
- Any Custom Access Token auth hook (Auth Hooks page stays empty).
- The legacy scalar `consignor_id` key — never written by this sprint.
- Any object in `raw`, `core`, or `semantic`; any existing RLS policy; any existing migration file; existing `portal_*` helper behaviour (they may delegate to the new per-user resolvers only if AC5 parity and all AC13 checks still pass).

## Cross-repo contract and gate
The mm-data-hub companion sprint consumes `public.claim_freshness` with this rule, at both doors: **if the presented token's `iat` (epoch seconds) is earlier than the user's `claims_updated_at`, treat `consignor_ids` as empty and `is_internal` as false.** Postgres door: one guard shared by `current_consignor_ids()` and `is_internal_claim()`. Cube door: `cube_readonly` has blanket read policies (`qual = true`, verified 2026-07-02), so Cube-side enforcement must apply the same rule in Cube Cloud's auth layer.

**Hard gate: no external grower user is provisioned until the companion guard is live at both doors.** Interim control until then: access-token expiry reduced 3600 → 600 seconds (actioned in the dashboard at scoping), capping any staleness system-wide at 10 minutes. Today's only two users are internal, so this sprint ships safely ahead of the companion.
