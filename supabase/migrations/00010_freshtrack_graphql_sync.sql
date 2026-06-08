-- =============================================================================
-- Migration 00010 — FreshTrack GraphQL sync target schema (purely additive)
-- =============================================================================
-- Source of truth: docs/FRESHTRACK-GRAPHQL-DISCOVERY.md (commit b9846ef) +
-- live probes 2026-06-08 (EntityNode 63 fields, FarmNode 7, HarvestLoadNode 34,
-- DispatchLoadNode 57, PalletNode 56, ChargeAppliedNode 47, OrderNode 36,
-- OrderItemNode 30, BoxNode 47).
--
-- Strategy: ADDITIVE ONLY. No DROP, no ALTER TYPE, no new NOT NULL on existing
-- rows. NOT-NULL tightening + UNIQUE-drop deferred to 00011 after backfill.
-- Re-runnable: CREATE … IF NOT EXISTS, ALTER … ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS then CREATE POLICY.
--
-- RLS helpers are in `private` (per migration 00009). New policies MUST call
-- private.portal_is_internal() / private.portal_can_see_farm(grower_id).
-- ft_* fact tables already have a `grower_id uuid` column FK'd to farms — the
-- rename in 00008 deliberately preserved the column name. Do NOT introduce a
-- second `farm_id` column.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Singleton invariant: the Mackays grower_group MUST exist for sync.
-- ---------------------------------------------------------------------------
insert into public.grower_groups (name, code, active)
values ('Mackays Marketing', 'MACKM', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 1. farms — absorb FarmNode + canonical UUID resolution key.
--    FarmNode is sparse (7 fields), 1:1 with EntityNode.farmId. Fold in.
-- ---------------------------------------------------------------------------
alter table public.farms
  add column if not exists freshtrack_entity_uuid uuid,
  add column if not exists freshtrack_farm_uuid    uuid,
  add column if not exists ft_region_id            uuid,
  add column if not exists ft_supplier_id          uuid,
  add column if not exists ft_time_zone            text,
  add column if not exists ft_geometry             jsonb,
  add column if not exists ft_is_consignor_active  boolean,
  add column if not exists ft_is_consignee_active  boolean,
  add column if not exists ft_is_farm_active       boolean,
  add column if not exists ft_parent_entity_uuid   uuid,    -- → rcti_recipients.freshtrack_entity_uuid
  add column if not exists ft_raw                  jsonb,
  add column if not exists synced_at               timestamptz;

create unique index if not exists farms_freshtrack_entity_uuid_key
  on public.farms (freshtrack_entity_uuid)
  where freshtrack_entity_uuid is not null;

create unique index if not exists farms_freshtrack_farm_uuid_key
  on public.farms (freshtrack_farm_uuid)
  where freshtrack_farm_uuid is not null;

create index if not exists idx_farms_ft_parent
  on public.farms(ft_parent_entity_uuid)
  where ft_parent_entity_uuid is not null;

-- ---------------------------------------------------------------------------
-- 2. rcti_recipients — EntityNode resolution key + display fields.
-- ---------------------------------------------------------------------------
alter table public.rcti_recipients
  add column if not exists freshtrack_entity_uuid uuid,
  add column if not exists freshtrack_code        text,
  add column if not exists ft_is_consignor_active boolean,
  add column if not exists ft_raw                 jsonb,
  add column if not exists synced_at              timestamptz;

create unique index if not exists rcti_recipients_freshtrack_entity_uuid_key
  on public.rcti_recipients (freshtrack_entity_uuid)
  where freshtrack_entity_uuid is not null;

create index if not exists idx_rcti_recipients_freshtrack_code
  on public.rcti_recipients (freshtrack_code)
  where freshtrack_code is not null;

-- ---------------------------------------------------------------------------
-- 3. ft_entities — raw EntityNode audit mirror (NOT business logic source).
-- ---------------------------------------------------------------------------
alter table public.ft_entities
  add column if not exists freshtrack_id          uuid,
  add column if not exists parent_freshtrack_id   uuid,
  add column if not exists farm_freshtrack_id     uuid,
  add column if not exists is_grower              boolean,
  add column if not exists is_consignor_active    boolean,
  add column if not exists is_consignee_active    boolean,
  add column if not exists is_marketer_active     boolean,
  add column if not exists is_farm_active         boolean,
  add column if not exists org_legal_name         text,
  add column if not exists raw_json               jsonb,
  add column if not exists synced_at              timestamptz;

create unique index if not exists ft_entities_freshtrack_id_key
  on public.ft_entities (freshtrack_id)
  where freshtrack_id is not null;

-- ---------------------------------------------------------------------------
-- 4. NEW TABLE — ft_harvest_loads (HarvestLoadNode grain: per-docket/per-farm).
--    grower_id mirrors other ft_* tables for RLS consistency.
-- ---------------------------------------------------------------------------
create table if not exists public.ft_harvest_loads (
  id                    uuid primary key default gen_random_uuid(),
  freshtrack_id         uuid not null unique,             -- HarvestLoadNode.id
  grower_id             uuid references public.farms(id), -- resolved via farm_freshtrack_id
  farm_freshtrack_id    uuid,                             -- FT FarmNode.id (HarvestLoadNode.farmId)
  entity_freshtrack_id  uuid,                             -- supplierId path
  docket_no             text not null,
  planting_description  text,
  harvested_on          timestamptz,
  received_on           timestamptz,
  is_purchased          boolean,
  is_blended            boolean,
  is_archived           boolean,
  shed_id               uuid,
  state_id              uuid,
  state_name            text,
  gp_group_id           uuid,
  gp_group_name         text,
  supplier_id           uuid,
  supplier_name         text,
  block_id              uuid,
  block_name            text,
  crop_id               uuid,
  crop_name             text,
  variety_id            uuid,
  variety_name          text,
  subvariety_id         uuid,
  subvariety_name       text,
  amount_total_purchased_value    numeric(14,4),
  amount_total_purchased_currency text,
  gross_weight_purchased_value    numeric(14,4),
  gross_weight_purchased_unit     text,
  total_bins_received   integer,
  total_bins_stored     integer,
  total_net_weight_value numeric(14,4),
  total_net_weight_unit  text,
  raw_json              jsonb,
  source_modified_on    timestamptz,         -- NULL — FT does not expose on this node
  synced_at             timestamptz not null default now()
);
alter table public.ft_harvest_loads enable row level security;
grant select on public.ft_harvest_loads to authenticated;
grant all    on public.ft_harvest_loads to service_role;

create index if not exists idx_ft_harvest_loads_grower         on public.ft_harvest_loads(grower_id);
create index if not exists idx_ft_harvest_loads_harvested_on   on public.ft_harvest_loads(harvested_on desc);
create index if not exists idx_ft_harvest_loads_farm_ft        on public.ft_harvest_loads(farm_freshtrack_id);

drop policy if exists "portal read ft_harvest_loads" on public.ft_harvest_loads;
create policy "portal read ft_harvest_loads" on public.ft_harvest_loads
  for select to authenticated
  using (private.portal_is_internal() or private.portal_can_see_farm(grower_id));

-- ---------------------------------------------------------------------------
-- 5. ft_dispatch — add DispatchLoadNode fields (grain stays per-load).
-- ---------------------------------------------------------------------------
alter table public.ft_dispatch
  add column if not exists freshtrack_id          uuid,
  add column if not exists order_type             text,
  add column if not exists scheduled_pickup_on    timestamptz,
  add column if not exists actual_pickup_on       timestamptz,
  add column if not exists scheduled_delivery_on  timestamptz,
  add column if not exists actual_delivery_on     timestamptz,
  add column if not exists pack_date              date,
  add column if not exists manifest_no            text,
  add column if not exists certificate_no         text,
  add column if not exists dc_slot_ref            text,
  add column if not exists order_no               text,
  add column if not exists sales_order_no         text,
  add column if not exists po_no                  text,
  add column if not exists stock_boxes            integer,
  add column if not exists reconsigned_boxes      integer,
  add column if not exists rejected_boxes         integer,
  add column if not exists repacked_boxes         integer,
  add column if not exists waste_boxes            integer,
  add column if not exists temperature_value      numeric(8,3),
  add column if not exists temperature_unit       text,
  add column if not exists is_complete            boolean,
  add column if not exists asn_sent_on            timestamptz,
  add column if not exists email_sent_on          timestamptz,
  add column if not exists is_locked              boolean,
  add column if not exists consignor_ft_id        uuid,   -- → rcti_recipient (parent entity)
  add column if not exists consignee_ft_id        uuid,
  add column if not exists marketer_ft_id         uuid,   -- = MACKM
  add column if not exists carrier_ft_id          uuid,
  add column if not exists raw_json               jsonb;
-- ft_dispatch already has synced_at + source_modified_on via 00001 baseline? Add defensively.
alter table public.ft_dispatch
  add column if not exists source_modified_on     timestamptz;

create unique index if not exists ft_dispatch_freshtrack_id_key
  on public.ft_dispatch (freshtrack_id) where freshtrack_id is not null;
create index if not exists idx_ft_dispatch_consignor_ft   on public.ft_dispatch(consignor_ft_id);
create index if not exists idx_ft_dispatch_pack_date      on public.ft_dispatch(pack_date desc);
create index if not exists idx_ft_dispatch_actual_pickup  on public.ft_dispatch(actual_pickup_on desc);

-- ---------------------------------------------------------------------------
-- 6. ft_pallets — PalletNode fields (per-pallet grain).
-- ---------------------------------------------------------------------------
alter table public.ft_pallets
  add column if not exists freshtrack_id          uuid,
  add column if not exists dispatch_load_ft_id    uuid,
  add column if not exists harvest_load_ft_id     uuid,
  add column if not exists pallet_no              text,
  add column if not exists barcode                text,
  add column if not exists packing_batch          text,
  add column if not exists stack_index            integer,
  add column if not exists packed_on              timestamptz,
  add column if not exists loaded_on              timestamptz,
  add column if not exists best_before            timestamptz,
  add column if not exists net_weight_value       numeric(12,3),
  add column if not exists net_weight_unit        text,
  add column if not exists gross_weight_value     numeric(12,3),
  add column if not exists gross_weight_unit      text,
  add column if not exists spaces                 numeric(8,3),
  add column if not exists box_count_decimal      numeric(8,2),
  add column if not exists expected_box_count     numeric(8,2),
  add column if not exists product_description    text,
  add column if not exists crop_description       text,
  add column if not exists variety_description    text,
  add column if not exists stock_boxes            integer,
  add column if not exists reconsigned_boxes      integer,
  add column if not exists rejected_boxes         integer,
  add column if not exists repacked_boxes         integer,
  add column if not exists waste_boxes            integer,
  add column if not exists is_field               boolean,
  add column if not exists is_archived            boolean,
  add column if not exists product_ft_id          uuid,
  add column if not exists consignee_ft_id        uuid,
  add column if not exists raw_json               jsonb,
  add column if not exists source_modified_on     timestamptz;

create unique index if not exists ft_pallets_freshtrack_id_key
  on public.ft_pallets (freshtrack_id) where freshtrack_id is not null;
create index if not exists idx_ft_pallets_dispatch_ft on public.ft_pallets(dispatch_load_ft_id);
create index if not exists idx_ft_pallets_harvest_ft  on public.ft_pallets(harvest_load_ft_id);
create index if not exists idx_ft_pallets_packed_on   on public.ft_pallets(packed_on desc);

-- ---------------------------------------------------------------------------
-- 7. ft_charges — ChargeAppliedNode (the only node with lastModifiedOn on node).
-- ---------------------------------------------------------------------------
alter table public.ft_charges
  add column if not exists freshtrack_id           uuid,
  add column if not exists charge_ft_id            uuid,
  add column if not exists dispatch_load_ft_id     uuid,
  add column if not exists original_dispatch_load_ft_id uuid,
  add column if not exists pallet_ft_id            uuid,
  add column if not exists box_ft_id               uuid,
  add column if not exists order_ft_id             uuid,
  add column if not exists harvest_load_ft_id      uuid,
  add column if not exists product_ft_id           uuid,
  add column if not exists supplier_ft_id          uuid,
  add column if not exists marketer_ft_id          uuid,
  add column if not exists text1                   text,
  add column if not exists text2                   text,
  add column if not exists text3                   text,
  add column if not exists account_code            text,
  add column if not exists ext_code                text,
  add column if not exists reference               text,
  add column if not exists quantity_value          numeric(14,4),
  add column if not exists quantity_unit           text,
  add column if not exists amount_value            numeric(14,4),
  add column if not exists amount_currency         text,
  add column if not exists total_amount_value      numeric(14,4),
  add column if not exists total_amount_currency   text,
  add column if not exists vat_info                text,
  add column if not exists applied_on              timestamptz,
  add column if not exists is_deductible           boolean,
  add column if not exists is_active               boolean,
  add column if not exists source_created_on       timestamptz,
  add column if not exists source_modified_on      timestamptz,   -- ChargeAppliedNode.lastModifiedOn
  add column if not exists raw_json                jsonb;

create unique index if not exists ft_charges_freshtrack_id_key
  on public.ft_charges (freshtrack_id) where freshtrack_id is not null;
create index if not exists idx_ft_charges_dispatch_ft on public.ft_charges(dispatch_load_ft_id);
create index if not exists idx_ft_charges_applied_on  on public.ft_charges(applied_on desc);
create index if not exists idx_ft_charges_modified_on on public.ft_charges(source_modified_on desc);

-- ---------------------------------------------------------------------------
-- 8. ft_orders — OrderNode fields.
-- ---------------------------------------------------------------------------
alter table public.ft_orders
  add column if not exists freshtrack_id          uuid,
  add column if not exists priority               integer,
  add column if not exists order_type             text,
  add column if not exists sales_order_no         text,
  add column if not exists po_no                  text,
  add column if not exists scheduled_pickup_on    timestamptz,
  add column if not exists actual_pickup_on       timestamptz,
  add column if not exists scheduled_delivery_on  timestamptz,
  add column if not exists actual_delivery_on     timestamptz,
  add column if not exists is_edi                 boolean,
  add column if not exists edi_status             text,
  add column if not exists consignor_ft_id        uuid,
  add column if not exists consignee_ft_id        uuid,
  add column if not exists marketer_ft_id         uuid,
  add column if not exists supplier_ft_id         uuid,
  add column if not exists latest_version_no      integer,
  add column if not exists is_archived            boolean,
  add column if not exists raw_json               jsonb,
  add column if not exists source_modified_on     timestamptz;

create unique index if not exists ft_orders_freshtrack_id_key
  on public.ft_orders (freshtrack_id) where freshtrack_id is not null;

-- ---------------------------------------------------------------------------
-- 9. NEW TABLE — ft_order_items (OrderItemNode grain).
-- ---------------------------------------------------------------------------
create table if not exists public.ft_order_items (
  id                    uuid primary key default gen_random_uuid(),
  freshtrack_id         uuid not null unique,
  order_version_id      uuid not null,
  product_ft_id         uuid,
  shed_ft_id            uuid,
  dispatch_load_ft_id   uuid,
  pallet_count          integer,
  boxes_per_pallet      integer,
  hand_stack            integer,
  is_split              boolean,
  ti                    integer,
  unsplit_hi            integer,
  bottom_hi             integer,
  top_hi                integer,
  price_value           numeric(14,4),
  price_currency        text,
  price_per             text,
  remitted_price_value  numeric(14,4),
  remitted_price_currency text,
  proposed_quantity     integer,
  proposed_price_value  numeric(14,4),
  proposed_price_currency text,
  discount_value        numeric(14,4),
  discount_currency     text,
  discount_percentage   numeric(8,4),
  item_no               text,
  ean13                 text,
  ean14                 text,
  line_no               integer,
  raw_json              jsonb,
  source_modified_on    timestamptz,
  synced_at             timestamptz not null default now()
);
alter table public.ft_order_items enable row level security;
grant select on public.ft_order_items to authenticated;
grant all    on public.ft_order_items to service_role;

create index if not exists idx_ft_order_items_order_version on public.ft_order_items(order_version_id);
create index if not exists idx_ft_order_items_dispatch_ft   on public.ft_order_items(dispatch_load_ft_id);

drop policy if exists "portal internal read ft_order_items" on public.ft_order_items;
create policy "portal internal read ft_order_items" on public.ft_order_items
  for select to authenticated using (private.portal_is_internal());

-- ---------------------------------------------------------------------------
-- 10. NEW TABLE — ft_boxes (BoxNode grain). Created but stays empty until UI.
-- ---------------------------------------------------------------------------
create table if not exists public.ft_boxes (
  id                     uuid primary key default gen_random_uuid(),
  freshtrack_id          uuid not null unique,
  parent_box_ft_id       uuid,
  pallet_ft_id           uuid,
  pallet_no              text,
  dispatch_load_ft_id    uuid,
  dispatch_load_load_no  text,
  original_dispatch_load_ft_id uuid,
  destination_dispatch_load_ft_id uuid,
  product_ft_id          uuid,
  shed_ft_id             uuid,
  serial_no              text,
  state                  text,
  packed_on              timestamptz,
  palletized_on          timestamptz,
  net_weight_value       numeric(12,3),
  net_weight_unit        text,
  gross_weight_value     numeric(12,3),
  gross_weight_unit      text,
  quantity               integer,
  group_uuid             uuid,
  crop_description       text,
  variety_description    text,
  subvariety_description text,
  is_archived            boolean,
  rejected_on            timestamptz,
  rejected_reason        text,
  wasted_on              timestamptz,
  wasted_reason          text,
  raw_json               jsonb,
  source_modified_on     timestamptz,
  synced_at              timestamptz not null default now()
);
alter table public.ft_boxes enable row level security;
grant select on public.ft_boxes to authenticated;
grant all    on public.ft_boxes to service_role;

create index if not exists idx_ft_boxes_pallet_ft   on public.ft_boxes(pallet_ft_id);
create index if not exists idx_ft_boxes_dispatch_ft on public.ft_boxes(dispatch_load_ft_id);
create index if not exists idx_ft_boxes_packed_on   on public.ft_boxes(packed_on desc);

drop policy if exists "portal internal read ft_boxes" on public.ft_boxes;
create policy "portal internal read ft_boxes" on public.ft_boxes
  for select to authenticated using (private.portal_is_internal());

-- ---------------------------------------------------------------------------
-- 11. NEW TABLE — ft_sync_state. Per-entity-type watermark cursor.
-- ---------------------------------------------------------------------------
create table if not exists public.ft_sync_state (
  entity_type           text primary key,
  last_modified_cursor  timestamptz,
  last_run_started_at   timestamptz,
  last_run_completed_at timestamptz,
  last_run_status       text check (last_run_status in ('running','success','failed','skipped_for_timeout') or last_run_status is null),
  last_error            text,
  rows_upserted         integer default 0,
  rows_seen             integer default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.ft_sync_state enable row level security;
grant select on public.ft_sync_state to authenticated;
grant all    on public.ft_sync_state to service_role;

drop policy if exists "portal internal read ft_sync_state" on public.ft_sync_state;
create policy "portal internal read ft_sync_state" on public.ft_sync_state
  for select to authenticated using (private.portal_is_internal());

insert into public.ft_sync_state (entity_type) values
  ('entities'),('dispatchLoads'),('pallets'),('chargesApplied'),
  ('harvestLoads'),('orders'),('orderItems'),('boxes')
on conflict (entity_type) do nothing;

-- ---------------------------------------------------------------------------
-- 12. NEW TABLE — private.freshtrack_auth_cache. Token store for the GraphQL
--     client. Single row; service_role only; NOT exposed via PostgREST.
-- ---------------------------------------------------------------------------
create table if not exists private.freshtrack_auth_cache (
  id           smallint primary key default 1 check (id = 1),
  token        text not null,
  device_name  text,
  expires_on   timestamptz not null,
  created_on   timestamptz not null,
  refreshed_at timestamptz not null default now()
);
revoke all on private.freshtrack_auth_cache from public, anon, authenticated;
grant select, insert, update, delete on private.freshtrack_auth_cache to service_role;

create or replace function private.get_freshtrack_token()
returns table(token text, expires_on timestamptz)
language sql security definer set search_path = private as $$
  select token, expires_on from private.freshtrack_auth_cache where id = 1;
$$;
revoke execute on function private.get_freshtrack_token() from public;
grant execute on function private.get_freshtrack_token() to service_role;

-- ---------------------------------------------------------------------------
-- 13. sync_logs — add per-step columns (run_id, step, window_start/end, payload).
-- ---------------------------------------------------------------------------
alter table public.sync_logs
  add column if not exists step          text,
  add column if not exists run_id        uuid,
  add column if not exists window_start  timestamptz,
  add column if not exists window_end    timestamptz,
  add column if not exists payload       jsonb;

create index if not exists idx_sync_logs_run_id on public.sync_logs(run_id);
create index if not exists idx_sync_logs_source_step_started
  on public.sync_logs(source, step, started_at desc);

-- ---------------------------------------------------------------------------
-- 14. Classification helper (used by the sync job).
-- ---------------------------------------------------------------------------
create or replace function private.ft_classify_entity(
  p_is_grower    boolean,
  p_parent_id    uuid,
  p_farm_id      uuid,
  p_has_children boolean,
  p_is_consignor boolean
) returns text language sql immutable set search_path = private as $$
  select case
    when not p_is_grower                                              then 'skip'
    when p_has_children                                               then 'rcti_recipient'
    when p_parent_id is null and p_is_consignor                       then 'self_paid_farm'
    when p_parent_id is not null                                      then 'farm'
    else                                                                   'orphan_farm'
  end
$$;
revoke execute on function private.ft_classify_entity(boolean,uuid,uuid,boolean,boolean) from public;
grant execute on function private.ft_classify_entity(boolean,uuid,uuid,boolean,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 15. Concurrency claim/release helpers.
-- ---------------------------------------------------------------------------
create or replace function private.claim_freshtrack_run()
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v_run_id   uuid;
  v_existing uuid;
begin
  -- Reap stale 'running' rows (>15 min).
  update public.sync_logs
     set status        = 'failed',
         error_message = 'killed_by_timeout',
         completed_at  = now()
   where source     = 'freshtrack'
     and step       = 'run'
     and status     = 'running'
     and started_at < now() - interval '15 minutes';

  select id into v_existing
    from public.sync_logs
   where source = 'freshtrack' and step = 'run' and status = 'running'
   limit 1;
  if v_existing is not null then return null; end if;

  if not pg_try_advisory_lock(hashtext('freshtrack_sync_v2')) then
    return null;
  end if;

  insert into public.sync_logs (source, sync_type, status, step, run_id)
  values ('freshtrack', 'incremental', 'running', 'run', gen_random_uuid())
  returning id into v_run_id;

  update public.sync_logs set run_id = id where id = v_run_id;
  return v_run_id;
end $$;
revoke execute on function private.claim_freshtrack_run() from public;
grant execute on function private.claim_freshtrack_run() to service_role;

create or replace function private.release_freshtrack_run(
  p_run_id  uuid,
  p_status  text,
  p_records integer,
  p_error   text
) returns void language plpgsql security definer set search_path = public, private as $$
begin
  update public.sync_logs
     set status         = p_status,
         records_synced = p_records,
         error_message  = p_error,
         completed_at   = now()
   where id = p_run_id;
  perform pg_advisory_unlock(hashtext('freshtrack_sync_v2'));
end $$;
revoke execute on function private.release_freshtrack_run(uuid,text,integer,text) from public;
grant execute on function private.release_freshtrack_run(uuid,text,integer,text) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Retire legacy v_power_bi_* sync_config rows (soft-disable, do not drop).
-- ---------------------------------------------------------------------------
update public.sync_config
   set enabled = false
 where sync_source = 'freshtrack'
   and source_view like 'v_power_bi_%'
   and enabled = true;

-- ---------------------------------------------------------------------------
-- 17. Legacy ft_consignments — comment-as-deprecated; cutover in 00012.
-- ---------------------------------------------------------------------------
comment on table public.ft_consignments is
  'DEPRECATED 2026-06-08. Grain (v_power_bi_consignments) does not match the '
  'FreshTrack GraphQL model. New harvest data lands in public.ft_harvest_loads. '
  'Retained read-only during cutover; sync stops writing here. Drop in 00012 '
  'after grower-portal pages migrate.';

commit;

-- ===========================================================================
-- DEFERRED to 00011 (after first clean sync run + backfill):
--   * alter table ft_dispatch alter column freshtrack_id set not null;
--   * same for ft_pallets / ft_charges / ft_orders / ft_entities / ft_harvest_loads
--   * drop unique on ft_*.ft_id (legacy bigint)
--   * drop unique on farms.freshtrack_code (canonical key is freshtrack_entity_uuid)
-- ===========================================================================