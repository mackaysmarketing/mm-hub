# Foundation Reconciliation — Repo vs Live Supabase (Sprint 0)

_Captured 2026-06-06 via read-only introspection of the live Supabase project
`mm_hub` (ref `uqzfkhsdyeokwnkpcxui`, ap-southeast-2). This is the real Sprint 0
baseline. **The repository migrations do NOT reproduce production.**_

## Headline

1. **The Next.js repo and the live database have forked.** The repo's
   migrations `00001`–`00004` were never applied as written. Production has only
   **two** migrations and a much simpler schema with **no tenant-isolation RLS**.
2. **Production RLS provides zero grower-group isolation.** Every data table has
   a single policy `"Authenticated can read <table>" USING (true)`. Any
   authenticated user can read every tenant's rows.
3. **Mitigating fact: the grower portal is pre-launch with no real data.**
   `growers = 0`, `remittances = 0`, `hub_users = 1`, `module_access = 1`,
   `grower_groups = 1`. So this is a **must-fix-before-launch**, not an active
   breach. It also means the two-axis model can be introduced with a clean
   migration — no grower-side backfill.
4. **The database is shared with a separate, undocumented module.** Live tables
   `quotes` (83 rows), `quote_daily_prices`, `retailers`, `products`,
   `product_retailer_mappings`, `distribution_centres`, `file_uploads` exist in
   prod but nowhere in this repo — a retailer price-quoting/promo module built
   directly against the same project. **Any RLS/schema work must not break it.**

## Live migration history

| version | name |
|---|---|
| `20260322194911` | `initial_schema` |
| `20260323114901` | `add_rls_policies` |

Repo migrations `00002_sync_config`, `00003_netsuite_sync_config`,
`00004_farms_and_grower_admin` have **no live counterpart**. (Live `growers`
*does* have `grower_group_id`, so an 00004-equivalent column change was applied
out-of-band.)

## Live RLS posture (what `add_rls_policies` actually did)

- **All grower data tables** — `growers`, `remittances`, `remittance_line_items`,
  `remittance_charges`, `ft_*`, `qa_*`, `documents`, `sync_logs` — have exactly
  one SELECT policy: **`USING (true)` for role `authenticated`.** No grower_group
  scoping, no grower_id scoping.
- **Admin tables** are saner: `hub_users`/`module_access` → users read own row +
  `is_hub_admin()` manages; `grower_groups`/`sync_config` → authenticated read +
  `is_hub_admin()`/hub_admin manage.
- **CRM tables** (`quotes`, `file_uploads`) additionally allow
  **`INSERT … WITH CHECK (true)`** for authenticated — flagged by Supabase
  advisors as bypassing RLS.
- **Only one DB function exists:** `is_hub_admin()` (SECURITY DEFINER).
  The repo's `get_portal_grower_id`, `get_portal_grower_ids`,
  `get_portal_grower_group_id`, `get_hub_role`, `has_capability`,
  `get_module_access`, `handle_new_user`, `update_updated_at` **do not exist in
  production.** The sophisticated RLS described in the repo is not deployed.

## Supabase security advisors (live)

- `is_hub_admin()` is executable by `anon` and `authenticated` via
  `/rest/v1/rpc/is_hub_admin` (SECURITY DEFINER exposed).
- `file_uploads` and `quotes` have always-true INSERT policies.
- Auth: leaked-password protection (HaveIBeenPwned) is disabled.

## What this means for the plan

- **The "capture the live RLS baseline into a migration" task is really
  "reconcile a forked database."** Before any RLS rewrite we must decide the
  source of truth (rebuild the DB to match a corrected repo — cheap now, no
  grower data — vs. reconcile the repo down to the live state) AND understand the
  ownership of the CRM/quoting module sharing this project.
- The two-axis (`farms` + `rcti_recipients`) redesign is **easier than feared**:
  with zero grower rows there is no painful backfill on the grower side.
- The wide-open RLS must be replaced with real group/axis-scoped policies
  **before any external grower logs in**, gated by the RLS-isolation test suite.

## Evidence pointers (this Sprint 0)

- Executable bug specs landed: [lib/portal-access.test.ts](lib/portal-access.test.ts)
  (getGrowerFilter IDOR) and [lib/financial-filter.test.ts](lib/financial-filter.test.ts)
  (financial-strip false negatives). `npm test` → 10 pass + 1 armed expected-fail.
- CI gate: [.github/workflows/ci.yml](.github/workflows/ci.yml) runs typecheck +
  lint + tests on PR.
