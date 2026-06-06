-- =============================================================================
-- MM-Hub Migration 00005 — Two-Axis Access Model + Real Tenant-Isolated RLS
-- =============================================================================
-- Establishes the two independent membership axes under grower_group:
--   * FARM (production)        — the FreshTrack entity. Today's `growers` table.
--   * RCTI RECIPIENT (financial) — who Mackays pays. NEW `rcti_recipients` table.
-- Non-negotiable cardinality: MANY FARMS PER RCTI RECIPIENT (growers.rcti_recipient_id).
--
-- Also REPLACES the wide-open production RLS (every grower table currently has
-- `"Authenticated can read X" USING (true)`) with group + axis-scoped policies.
--
-- SAFETY:
--   * Additive & non-destructive — no data is dropped; only permissive policies
--     are replaced with stricter ones, and new tables/columns are added.
--   * Does NOT touch the CRM/quoting module tables (quotes, quote_daily_prices,
--     retailers, products, product_retailer_mappings, distribution_centres,
--     file_uploads) or hub_users / module_access policies.
--   * Re-runnable: guards with IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE.
--   * service_role has BYPASSRLS in Supabase, so the sync path is unaffected.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Shared updated_at trigger fn (repo baseline fn is absent in prod).
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- -----------------------------------------------------------------------------
-- 0b. BASELINE RECONCILE (idempotent) — objects that exist in prod out-of-band
--     but are absent from the tracked migration history, so the repo can rebuild
--     the full baseline from scratch. No-ops where they already exist.
-- -----------------------------------------------------------------------------
create table if not exists public.grower_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  abn text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.grower_groups enable row level security;
grant select on public.grower_groups to authenticated;
grant all on public.grower_groups to service_role;

drop trigger if exists grower_groups_updated_at on public.grower_groups;
create trigger grower_groups_updated_at before update on public.grower_groups
  for each row execute function public.set_updated_at();

alter table public.growers add column if not exists grower_group_id uuid references public.grower_groups(id);
create index if not exists idx_growers_group on public.growers(grower_group_id);

-- Internal-admin predicate (prod hotfix 338fcbd, never captured as a migration).
create or replace function public.is_hub_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hub_users where id = auth.uid() and hub_role = 'hub_admin')
$$;

-- Keep hub_admin management of grower_groups (idempotent).
drop policy if exists "Hub admins can manage grower_groups" on public.grower_groups;
create policy "Hub admins can manage grower_groups" on public.grower_groups
  for all to authenticated using (public.is_hub_admin());

-- -----------------------------------------------------------------------------
-- 1. FINANCIAL AXIS — rcti_recipients (who Mackays pays). New first-class entity.
-- -----------------------------------------------------------------------------
create table if not exists public.rcti_recipients (
  id uuid primary key default gen_random_uuid(),
  grower_group_id uuid not null references public.grower_groups(id) on delete cascade,
  name text not null,
  abn text,
  netsuite_entity_id text unique,        -- financial-axis resolution key (NetSuite)
  netsuite_entity_code text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_rcti_recipients_group on public.rcti_recipients(grower_group_id);
alter table public.rcti_recipients enable row level security;
grant select on public.rcti_recipients to authenticated;
grant all on public.rcti_recipients to service_role;

drop trigger if exists rcti_recipients_updated_at on public.rcti_recipients;
create trigger rcti_recipients_updated_at before update on public.rcti_recipients
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. PRODUCTION AXIS — link each farm (growers row) to its paying recipient.
--    MANY farms -> ONE recipient (the non-negotiable cardinality).
-- -----------------------------------------------------------------------------
alter table public.growers
  add column if not exists rcti_recipient_id uuid references public.rcti_recipients(id);
create index if not exists idx_growers_recipient on public.growers(rcti_recipient_id);

-- -----------------------------------------------------------------------------
-- 3. REMITTANCES — financial grain = recipient; add per-line farm attribution.
--    (grower_id is retained during transition; sync will populate recipient_id.)
-- -----------------------------------------------------------------------------
alter table public.remittances
  add column if not exists recipient_id uuid references public.rcti_recipients(id);
create index if not exists idx_remittances_recipient on public.remittances(recipient_id);

alter table public.remittance_line_items
  add column if not exists farm_id uuid references public.growers(id);
create index if not exists idx_remittance_lines_farm on public.remittance_line_items(farm_id);

-- -----------------------------------------------------------------------------
-- 4. ACCESS-CONTEXT HELPERS (SECURITY DEFINER — bypass RLS to resolve scope).
--    grower-portal module_access.config shape:
--      { grower_group_id, grower_ids (farms; null=all in group),
--        recipient_ids (null=all in group), allowed_menu_items,
--        financial_access, capabilities }
-- -----------------------------------------------------------------------------
create or replace function public.portal_group_id()
returns uuid language sql stable security definer set search_path = public as $$
  select (config->>'grower_group_id')::uuid from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

create or replace function public.portal_role()
returns text language sql stable security definer set search_path = public as $$
  select module_role from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

-- Internal Mackays user — sees ALL tenants (hub_admin, or module admin/staff).
create or replace function public.portal_is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hub_admin() or public.portal_role() in ('admin','staff')
$$;

-- Farm scope: NULL = all farms in the user's group (admin/staff/grower_admin, or
-- grower with grower_ids null). Otherwise the explicit farm-id array.
create or replace function public.portal_farm_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when public.portal_role() in ('admin','staff','grower_admin') then null
    when config->'grower_ids' is null or jsonb_typeof(config->'grower_ids') <> 'array' then null
    else array(select (jsonb_array_elements_text(config->'grower_ids'))::uuid)
  end
  from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

-- Recipient scope: NULL = all recipients in the user's group.
create or replace function public.portal_recipient_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when public.portal_role() in ('admin','staff','grower_admin') then null
    when config->'recipient_ids' is null or jsonb_typeof(config->'recipient_ids') <> 'array' then null
    else array(select (jsonb_array_elements_text(config->'recipient_ids'))::uuid)
  end
  from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

-- Can the current user see this farm? (group match + farm-scope match)
create or replace function public.portal_can_see_farm(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from growers g
    where g.id = p_farm_id
      and g.grower_group_id = public.portal_group_id()
      and (public.portal_farm_ids() is null or g.id = any(public.portal_farm_ids()))
  )
$$;

-- Can the current user see this recipient? (group match + recipient-scope match)
create or replace function public.portal_can_see_recipient(p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rcti_recipients r
    where r.id = p_recipient_id
      and r.grower_group_id = public.portal_group_id()
      and (public.portal_recipient_ids() is null or r.id = any(public.portal_recipient_ids()))
  )
$$;

-- Parent-resolving helpers for child tables.
create or replace function public.portal_can_see_remittance(p_remittance_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from remittances rm
    where rm.id = p_remittance_id
      and (public.portal_is_internal() or public.portal_can_see_recipient(rm.recipient_id))
  )
$$;

create or replace function public.portal_can_see_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qa_assessments qa
    where qa.id = p_assessment_id
      and (public.portal_is_internal() or public.portal_can_see_farm(qa.grower_id))
  )
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS REWRITE — drop the wide-open "Authenticated can read X" policies and
--    install group + axis-scoped policies. SELECT only for the user client;
--    writes go through service_role (BYPASSRLS).
-- -----------------------------------------------------------------------------

-- grower_groups: a user sees their own group; internal sees all. (Keep hub manage.)
drop policy if exists "Authenticated users can read grower_groups" on public.grower_groups;
drop policy if exists "Portal staff read all grower_groups" on public.grower_groups;
drop policy if exists "Grower read own group" on public.grower_groups;
create policy "portal read grower_groups" on public.grower_groups
  for select to authenticated
  using (public.portal_is_internal() or id = public.portal_group_id());

-- rcti_recipients (financial axis, self-scoped)
drop policy if exists "portal read rcti_recipients" on public.rcti_recipients;
create policy "portal read rcti_recipients" on public.rcti_recipients
  for select to authenticated
  using (
    public.portal_is_internal()
    or (grower_group_id = public.portal_group_id()
        and (public.portal_recipient_ids() is null or id = any(public.portal_recipient_ids())))
  );

-- growers / farms (production axis, self-scoped)
drop policy if exists "Authenticated can read growers" on public.growers;
drop policy if exists "Portal staff read all growers" on public.growers;
drop policy if exists "Grower read own" on public.growers;
drop policy if exists "Hub admin read all growers" on public.growers;
drop policy if exists "Grower group member read growers" on public.growers;
create policy "portal read growers" on public.growers
  for select to authenticated
  using (
    public.portal_is_internal()
    or (grower_group_id = public.portal_group_id()
        and (public.portal_farm_ids() is null or id = any(public.portal_farm_ids())))
  );

-- Farm-axis fact tables (each has grower_id -> growers.id)
do $$
declare t text;
begin
  foreach t in array array[
    'ft_consignments','ft_orders','ft_pallets','ft_dispatch','ft_charges',
    'ft_stock','qa_assessments','qa_audits','documents'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Authenticated can read '||t, t);
    execute format('drop policy if exists %I on public.%I', 'portal read '||t, t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (public.portal_is_internal() or public.portal_can_see_farm(grower_id))
    $f$, 'portal read '||t, t);
  end loop;
end $$;

-- ft_entities (matched by entity_code -> growers.freshtrack_code)
drop policy if exists "Authenticated can read ft_entities" on public.ft_entities;
drop policy if exists "portal read ft_entities" on public.ft_entities;
create policy "portal read ft_entities" on public.ft_entities
  for select to authenticated
  using (
    public.portal_is_internal()
    or exists (
      select 1 from growers g
      where g.freshtrack_code = ft_entities.entity_code
        and public.portal_can_see_farm(g.id)
    )
  );

-- remittances (financial axis -> recipient)
drop policy if exists "Authenticated can read remittances" on public.remittances;
create policy "portal read remittances" on public.remittances
  for select to authenticated
  using (public.portal_is_internal() or public.portal_can_see_recipient(recipient_id));

-- remittance children (via remittance_id)
drop policy if exists "Authenticated can read remittance_line_items" on public.remittance_line_items;
create policy "portal read remittance_line_items" on public.remittance_line_items
  for select to authenticated
  using (public.portal_can_see_remittance(remittance_id));

drop policy if exists "Authenticated can read remittance_charges" on public.remittance_charges;
create policy "portal read remittance_charges" on public.remittance_charges
  for select to authenticated
  using (public.portal_can_see_remittance(remittance_id));

-- qa_category_scores (via assessment_id)
drop policy if exists "Authenticated can read qa_category_scores" on public.qa_category_scores;
create policy "portal read qa_category_scores" on public.qa_category_scores
  for select to authenticated
  using (public.portal_can_see_assessment(assessment_id));

-- sync_logs / sync_config — internal/hub only (not grower-facing tenant data).
drop policy if exists "Authenticated can read sync_logs" on public.sync_logs;
create policy "portal internal read sync_logs" on public.sync_logs
  for select to authenticated using (public.portal_is_internal());

drop policy if exists "Authenticated can read sync_config" on public.sync_config;
create policy "portal internal read sync_config" on public.sync_config
  for select to authenticated using (public.portal_is_internal());

-- ft_products is shared reference data (catalog) — keep authenticated read.
--   (left intentionally open; no tenant data.)

commit;
