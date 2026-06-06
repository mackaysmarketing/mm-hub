# MM-Hub Grower Portal — Session Handoff

_Captured 2026-06-06 at end of the foundation rebuild session._
_Replaces stale guidance in `PROGRESS.md` and `grower_portal/Mackays-Grower-Portal-Spec-v2.md`._

## Where this is

Branch `sprint-0-foundation` on origin, **14 commits** ahead of `main`. Every
commit gates on typecheck + lint + 17 vitest tests + `next build`. PR link:
https://github.com/mackaysmarketing/mm-hub/pull/new/sprint-0-foundation.

Prod Supabase (`mm_hub`, ref `uqzfkhsdyeokwnkpcxui`) currently has migrations
00005, 00006, 00007, and 00008 applied. Pre-launch (no grower rows yet); the
shared CRM/quoting tables (`quotes`, `retailers`, etc.) are untouched.

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
| `is_hub_admin()` | bool | gates admin policies + portal_is_internal |
| `portal_group_id()` | uuid | the user's grower_group_id |
| `portal_role()` | text | their grower-portal module_role |
| `portal_is_internal()` | bool | hub_admin OR (admin/staff) — sees all tenants |
| `portal_farm_ids()` | uuid[]/null | null = all farms in group, else explicit set |
| `portal_recipient_ids()` | uuid[]/null | null = all recipients in group, else explicit |
| `portal_can_see_farm(uuid)` | bool | per-farm authz check |
| `portal_can_see_recipient(uuid)` | bool | per-recipient authz check |
| `portal_can_see_remittance(uuid)` | bool | resolves through recipient |
| `portal_can_see_assessment(uuid)` | bool | resolves through farm |

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
  fixtures/
    rcti-sample-LMB-Cooroo-2026-06-03.txt   extracted PDF text for future
                                            reconciliation tests
  tests/
    rls_isolation.sql                  the persona matrix as a runnable script
```

## Two things the user owns next

1. **Confirm the rebuild works end-to-end** by doing the manual smoke test
   above. If anything is off, file it as a new issue.
2. **NetSuite raw export.** Get a non-empty sample of the raw RCTI data file
   that lands on SFTP alongside the PDF. With that, the proper consolidation
   pipeline is unblockable.
