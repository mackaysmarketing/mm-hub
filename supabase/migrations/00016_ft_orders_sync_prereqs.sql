-- =============================================================================
-- Migration 00014 — Prerequisites for ft_orders / ft_order_items sync (Phase 1)
-- =============================================================================
-- Part A — finish the job migration 00013 deliberately deferred.
--
--   00013 converted the partial UNIQUE index on freshtrack_id → full UNIQUE for
--   ft_entities, ft_dispatch, ft_charges and ft_pallets, and said:
--
--     "ft_orders has the same partial-index shape but isn't currently synced —
--      left untouched to keep the change surface minimal; revisit when
--      ft_orders sync is added."
--
--   ft_orders sync is now being added, so revisit. Confirmed on prod
--   2026-07-30 — ft_orders still has the partial form:
--
--     CREATE UNIQUE INDEX ft_orders_freshtrack_id_key
--       ON public.ft_orders USING btree (freshtrack_id)
--       WHERE (freshtrack_id IS NOT NULL);          -- ← PARTIAL
--
--   supabase-js sends bare `.upsert([...], { onConflict: "freshtrack_id" })`
--   with no WHERE, so Postgres cannot infer a partial index and the first
--   orderSync run would fail with 42P10. ft_orders has 0 rows, so the
--   conversion is safe. UNIQUE defaults to NULLS DISTINCT, so any future rows
--   with a null freshtrack_id are still permitted.
--
--   ft_order_items already has a full UNIQUE constraint
--   (ft_order_items_freshtrack_id_key, created clean in 00010) — untouched.
--
-- Part B — columns OrderNode exposes that ft_orders had no home for.
--   Chiefly `state_ft_id` / `state_name`: the consignor auto-assignment process
--   needs to exclude CANCELLED orders, and reading that out of raw_json on
--   every candidate query is both slow and easy to get wrong.
--
-- Part C — item-sync bookkeeping. There is no modifiedOn on OrderNode and
--   latestVersionNo is 1 on every order observed, so the item fan-out is made
--   incremental "by absence": step 7 only fetches items for orders whose
--   items_synced_version is null or behind latest_version_no. Without this the
--   fan-out would re-query every order in the window every night (2 GraphQL
--   calls each) and blow the step budget.
--
-- Re-runnable: every statement is IF NOT EXISTS / existence-checked.
-- =============================================================================

begin;

-- ---------------------------------------------------------------- Part A ----
do $$
declare
  v_pred text;
begin
  select pg_get_expr(ix.indpred, ix.indrelid)
    into v_pred
    from pg_index ix
    join pg_class i    on i.oid = ix.indexrelid
    join pg_class c    on c.oid = ix.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'ft_orders'
     and i.relname = 'ft_orders_freshtrack_id_key';

  if v_pred is not null then
    -- exists AND is partial → drop + recreate as full, same name
    drop index public.ft_orders_freshtrack_id_key;
    create unique index ft_orders_freshtrack_id_key
      on public.ft_orders (freshtrack_id);
  elsif not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ft_orders_freshtrack_id_key'
  ) then
    -- absent entirely → create full
    create unique index ft_orders_freshtrack_id_key
      on public.ft_orders (freshtrack_id);
  end if;
  -- already full (re-run) → no-op
end $$;

-- ---------------------------------------------------------------- Part B ----
alter table public.ft_orders
  add column if not exists state_ft_id             uuid,
  add column if not exists state_name              text,
  add column if not exists shed_ft_id              uuid,
  add column if not exists market_area_ft_id       uuid,
  add column if not exists parent_consignee_ft_id  uuid,
  add column if not exists delivery_contact_ft_id  uuid,
  add column if not exists sale_entity_ft_id       uuid,
  add column if not exists comment                 text,
  add column if not exists total_ordered           integer,
  add column if not exists info                    text;

comment on column public.ft_orders.state_name is
  'FreshTrack OrderState name, denormalised from state_ft_id. Used by the '
  'consignor auto-assignment process to exclude cancelled orders without a join.';

-- ---------------------------------------------------------------- Part C ----
alter table public.ft_orders
  add column if not exists latest_order_version_ft_id uuid,
  add column if not exists items_synced_version       integer,
  add column if not exists items_synced_at            timestamptz,
  -- Crop set, cached by step 7 from orderItem.productId → product.cropId.
  -- The consignor auto-assignment process needs crop for crop-specific rules;
  -- caching it here saves re-spending 2 GraphQL calls per candidate order.
  add column if not exists crop_ft_ids                uuid[],
  add column if not exists crop_names                 text[];

comment on column public.ft_orders.items_synced_version is
  'latest_version_no at the time ft_order_items was last populated for this '
  'order. NULL = items never fetched. Step 7 fans out only where items_stale '
  'is true, making the per-order item fetch incremental by absence '
  '(FreshTrack exposes no modifiedOn on OrderNode).';

-- PostgREST cannot express a column-to-column comparison in a filter — a
-- literal `items_synced_version.lt.latest_version_no` compares against the
-- STRING "latest_version_no". So the predicate is materialised as a generated
-- column that step 7 can filter with a plain .eq() and that is indexable.
alter table public.ft_orders
  add column if not exists items_stale boolean
    generated always as (
      items_synced_version is null
      or items_synced_version < coalesce(latest_version_no, 0)
    ) stored;

comment on column public.ft_orders.items_stale is
  'TRUE when ft_order_items needs (re)fetching for this order. Generated, so it '
  'cannot drift from its inputs. Exists because PostgREST has no column-vs-'
  'column filter operator.';

-- Legacy-compat note: order_date / customer_name / product_name / status and
-- friends predate the GraphQL sync (migration 00001 vintage) and are what
-- app/api/orders/route.ts actually selects and filters on — including
-- `.gte("order_date", ...)`, which silently drops NULL rows. orderSync
-- therefore populates them as documented approximations; see orderSync.ts.
comment on column public.ft_orders.order_date is
  'LEGACY column consumed by app/api/orders. FreshTrack OrderNode exposes no '
  'created/raised date, so orderSync fills this with '
  'date(scheduledDeliveryOn ?? scheduledPickupOn). Treat as the delivery axis, '
  'not the date the order was raised.';

-- --------------------------------------------------------------- Part D ----
-- ft_order_items had NO link to its order — only order_version_id, which can
-- only be resolved back to an order for the CURRENT latest version. Joining
-- lines to orders is a core need (the rollup, the Orders UI, the consignor
-- process), so carry the order id on the row.
alter table public.ft_order_items
  add column if not exists order_ft_id uuid;

comment on column public.ft_order_items.order_ft_id is
  'FreshTrack order id this line belongs to. Denormalised because '
  'order_version_id only resolves to an order via ft_orders.'
  'latest_order_version_ft_id, which breaks for superseded versions.';

-- ------------------------------------------------------------- Indexes ------
-- Candidate-window scan for the consignor process + the /api/orders listing.
create index if not exists idx_ft_orders_scheduled_delivery_on
  on public.ft_orders (scheduled_delivery_on desc);
create index if not exists idx_ft_orders_order_date
  on public.ft_orders (order_date desc);
create index if not exists idx_ft_orders_consignee_ft
  on public.ft_orders (consignee_ft_id);
create index if not exists idx_ft_orders_consignor_ft
  on public.ft_orders (consignor_ft_id);
create index if not exists idx_ft_orders_grower
  on public.ft_orders (grower_id);
-- Drives step 7's "which orders still need items?" query.
create index if not exists idx_ft_orders_items_stale
  on public.ft_orders (scheduled_delivery_on desc)
  where items_stale;
create index if not exists idx_ft_order_items_order_ft
  on public.ft_order_items (order_ft_id);

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   -- A: expect where_clause IS NULL
--   select i.relname, pg_get_expr(ix.indpred, ix.indrelid) as where_clause
--     from pg_index ix
--     join pg_class i on i.oid = ix.indexrelid
--     join pg_class c on c.oid = ix.indrelid
--    where c.relname = 'ft_orders'
--      and i.relname = 'ft_orders_freshtrack_id_key';
--
--   -- B/C: expect 13 rows
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='ft_orders'
--      and column_name in ('state_ft_id','state_name','shed_ft_id',
--        'market_area_ft_id','parent_consignee_ft_id','delivery_contact_ft_id',
--        'sale_entity_ft_id','comment','total_ordered','info',
--        'latest_order_version_ft_id','items_synced_version','items_synced_at');
-- =============================================================================
