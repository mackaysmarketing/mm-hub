# FreshTrack GraphQL Sync — Runbook

_End of sprint 3. Everything in this doc is needed to take the GraphQL sync
from "code on a branch" to "running in prod"._

## Status

| Piece | State |
|---|---|
| Migration `00010_freshtrack_graphql_sync.sql` (~30KB, additive only) | ✅ Branch-validated + **applied to prod** 2026-06-08 |
| Migration `00011_grower_groups_code_unique.sql` (prod-reproducibility patch) | ✅ Applied to prod (was needed for 00010's ON CONFLICT (code)) |
| `lib/freshtrack-graphql.ts` transport + `lib/freshtrack/queries.ts` + `lib/freshtrack/classify.ts` | ✅ Tested (34 vitest, mocked fetch + live smoke against FT) |
| `lib/freshtrack/sync/*.ts` (cursor, logger, windowing, entitySync, dispatchSync, palletSync, harvestSync, chargeSync) | ✅ Code complete |
| `app/api/cron/sync-freshtrack/route.ts` orchestrator | ✅ Code complete; gated behind `FRESHTRACK_GRAPHQL_SYNC_ENABLED=true` |
| `app/api/hub-admin/freshtrack-catalogue` + UI tab in FarmDialog | ✅ Code complete |
| Branch-validation via Supabase MCP | ✅ Completed 2026-06-08 (5-category classifier verified, concurrency claim/release verified, all sanity counts match) |

## Why MCP is blocked, and the workaround

The Supabase MCP server began returning `MCP error -32600: You do not have
permission to perform this action` across **every** tool (list_branches,
execute_sql, apply_migration, …) shortly after the multi-agent design
workflow completed. The auth scope for the session is no longer recognised.

**Workaround:** apply migration 00010 via the Supabase Dashboard SQL editor
(or via psql with the service_role connection string). It is purely additive
and idempotent — re-runnable, no destructive operations.

```sql
-- Paste the whole file in:
\i supabase/migrations/00010_freshtrack_graphql_sync.sql
```

The migration:
- Adds nullable columns + indexes to `farms`, `rcti_recipients`,
  `ft_entities`, `ft_dispatch`, `ft_pallets`, `ft_charges`, `ft_orders`.
- Creates 4 new tables: `ft_harvest_loads`, `ft_order_items`, `ft_boxes`,
  `ft_sync_state`.
- Creates `private.freshtrack_auth_cache` (token store, service-role only).
- Creates 4 helper functions in `private`: `ft_classify_entity`,
  `claim_freshtrack_run`, `release_freshtrack_run`, `get_freshtrack_token`.
- Seeds the singleton `MACKM` `grower_groups` row.
- Soft-disables legacy `sync_config` rows pointing at `v_power_bi_*` views.
- Adds DEPRECATED comment to `ft_consignments` (cutover separate).

## Bringing the sync online (the order matters)

### 1. Apply migration 00010

Via Supabase Dashboard SQL editor (or psql). Confirm with:

```sql
select count(*) from grower_groups where code = 'MACKM';            -- expect 1
select count(*) from ft_sync_state;                                  -- expect 8 rows
select column_name from information_schema.columns
  where table_name = 'farms'
    and column_name in ('freshtrack_entity_uuid','freshtrack_farm_uuid','ft_region_id','ft_raw');
                                                                     -- expect 4 rows
select column_name from information_schema.columns
  where table_name = 'ft_entities' and column_name = 'classification';
                                                                     -- expect 1 row
select private.ft_classify_entity(true,  null,            'f'::uuid, false, true);  -- 'self_paid_farm'
select private.ft_classify_entity(true,  'p'::uuid,       null,      false, false); -- 'farm'
select private.ft_classify_entity(true,  null,            null,      true,  false); -- 'rcti_recipient'
select private.ft_classify_entity(false, null,            null,      false, false); -- 'skip'
```

### 2. Set the env vars on Vercel (production)

```
FRESHTRACK_GRAPHQL_SYNC_ENABLED = true
FT_GRAPHQL_EMAIL               = mmhub-integration@mackaysmarketing.com.au   (or whatever you provisioned)
FT_GRAPHQL_PASSWORD            = <secret>
FT_MACKM_MARKETER_ID           = 0192035b-0cf8-4e5f-8675-e6144ff7df99
# FT_GRAPHQL_URL — leave unset; defaults to the public mackays URL.
```

The same vars in `.env.local` for local dev. `.env.local.example` shows the
full surface.

### 3. First run

Trigger `GET /api/cron/sync-freshtrack` once manually with the cron secret:

```
curl -X GET "https://<your-prod-domain>/api/cron/sync-freshtrack" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response (after ~10–60s):

```jsonc
{
  "status": "success",
  "runId": "<uuid>",
  "duration": 15234,
  "totalRecords": 12345,
  "steps": [
    { "step": "entities",  "status": "success", "recordsSynced": 200, ... },
    { "step": "harvests",  "status": "success", "recordsSynced":  XX, ... },
    { "step": "dispatch",  "status": "success", "recordsSynced":  XX, ... },
    { "step": "pallets",   "status": "success", "recordsSynced": XXX, ... },
    { "step": "charges",   "status": "success", "recordsSynced":  XX, ... }
  ]
}
```

Spot-check the DB:

```sql
select source, step, status, records_synced, started_at, completed_at, error_message
  from sync_logs
 where source = 'freshtrack'
 order by started_at desc
 limit 10;

select entity_type, last_modified_cursor, last_run_status, rows_upserted
  from ft_sync_state
 order by entity_type;

select count(*) from ft_entities where classification is not null;     -- expect ~200
select count(*) filter (where classification = 'farm') as farms,
       count(*) filter (where classification = 'self_paid_farm') as self_paid,
       count(*) filter (where classification = 'rcti_recipient') as recipients
  from ft_entities;
```

### 4. Provision a real farm through the catalogue picker

Hub admin → Grower Groups → \<a group\> → Add Farm → "Pick from FreshTrack"
tab → search "Cooroo" → pick **LMBCO**. Confirm:

```sql
select id, name, freshtrack_code, freshtrack_entity_uuid, freshtrack_farm_uuid
  from farms
 where freshtrack_entity_uuid is not null
 order by created_at desc
 limit 5;

select freshtrack_id, entity_code, classification, is_provisioned
  from ft_entities
 where entity_code = 'LMBCO';   -- is_provisioned should now be true
```

### 5. Concurrency + kill-switch sanity

While a run is in progress, hit the route again — expect
`{status:"skipped", reason:"another freshtrack run is in progress"}`.
Set `FRESHTRACK_GRAPHQL_SYNC_ENABLED=false` and hit again — expect
`{status:"disabled"}`.

## Rollback

Migration 00010 is purely additive — no DROP, no ALTER TYPE, no new NOT
NULL on existing rows. To roll back:

1. Set `FRESHTRACK_GRAPHQL_SYNC_ENABLED=false` (instant kill switch).
2. If you also need to remove the schema: drop the 4 new tables
   (`ft_harvest_loads`, `ft_order_items`, `ft_boxes`, `ft_sync_state`),
   `ALTER TABLE` away the new columns, drop the 4 `private` functions,
   delete the `private.freshtrack_auth_cache` row + table. None of this is
   urgent because nothing in the existing app reads the new columns/tables.

## Open items (post sprint 3)

- **Apply 00010 to a Supabase branch** for full pre-prod validation. Blocked
  on MCP recovery or by switching to a service-role psql connection.
- **Weekly Sunday full-resync** cron route (synthesis open decision A7,
  recommended). Not built — separate commit.
- **NetSuite RCTI entity catalogue** picker for the rcti_recipients side.
  Gated on a NetSuite GraphQL or REST sync existing, which is out of scope
  here.
- **`ft_consignments` cutover** — currently retained with a DEPRECATED
  comment. Cutover the grower-portal pages that read it onto
  `ft_harvest_loads` in a future PR, then drop in `00012`.
- **Migration 00011** — set NOT NULL on `freshtrack_id` columns and drop
  `farms.freshtrack_code UNIQUE` after the first clean sync proves no
  collisions.
