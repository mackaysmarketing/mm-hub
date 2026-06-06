-- =============================================================================
-- MM-Hub Migration 00009 — Move RLS helpers to `private` schema
-- =============================================================================
-- Supabase advisors flag the portal_* SECURITY DEFINER functions in `public`
-- as RPC-callable by `anon`/`authenticated` via /rest/v1/rpc/<func>. While the
-- functions only ever reveal data within the caller's own scope, exposing
-- them adds a needless probe vector (e.g. enumerate valid farm uuids by
-- timing portal_can_see_farm).
--
-- Fix: move them to a `private` schema not exposed by PostgREST. RLS policies
-- referencing them are recreated with schema-qualified names. EXECUTE granted
-- to authenticated so RLS can still call them; the schema is excluded from
-- PostgREST so RPC calls to /rest/v1/rpc/portal_* return 404.
--
-- The remaining public function `is_hub_admin` is also moved for the same
-- reason; it's referenced by the hub_users/module_access/grower_groups
-- policies (the prod hotfix from commit 338fcbd).
-- =============================================================================

begin;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---- 1. Recreate helpers in private schema --------------------------------

create or replace function private.is_hub_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hub_users where id = auth.uid() and hub_role = 'hub_admin')
$$;

create or replace function private.portal_group_id()
returns uuid language sql stable security definer set search_path = public as $$
  select (config->>'grower_group_id')::uuid from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

create or replace function private.portal_role()
returns text language sql stable security definer set search_path = public as $$
  select module_role from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

create or replace function private.portal_is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_hub_admin() or private.portal_role() in ('admin','staff')
$$;

create or replace function private.portal_farm_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when private.portal_role() in ('admin','staff','grower_admin') then null
    when config->'grower_ids' is null or jsonb_typeof(config->'grower_ids') <> 'array' then null
    else array(select (jsonb_array_elements_text(config->'grower_ids'))::uuid)
  end
  from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

create or replace function private.portal_recipient_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when private.portal_role() in ('admin','staff','grower_admin') then null
    when config->'recipient_ids' is null or jsonb_typeof(config->'recipient_ids') <> 'array' then null
    else array(select (jsonb_array_elements_text(config->'recipient_ids'))::uuid)
  end
  from module_access
  where user_id = auth.uid() and module_id = 'grower-portal' and active = true limit 1
$$;

create or replace function private.portal_can_see_farm(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from farms f
    where f.id = p_farm_id
      and f.grower_group_id = private.portal_group_id()
      and (private.portal_farm_ids() is null or f.id = any(private.portal_farm_ids()))
  )
$$;

create or replace function private.portal_can_see_recipient(p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rcti_recipients r
    where r.id = p_recipient_id
      and r.grower_group_id = private.portal_group_id()
      and (private.portal_recipient_ids() is null or r.id = any(private.portal_recipient_ids()))
  )
$$;

create or replace function private.portal_can_see_remittance(p_remittance_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from remittances rm
    where rm.id = p_remittance_id
      and (private.portal_is_internal() or private.portal_can_see_recipient(rm.recipient_id))
  )
$$;

create or replace function private.portal_can_see_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qa_assessments qa
    where qa.id = p_assessment_id
      and (private.portal_is_internal() or private.portal_can_see_farm(qa.grower_id))
  )
$$;

grant execute on all functions in schema private to authenticated;

-- Pin search_path on the only remaining public function with a mutable one
-- (closes the last self-owned Supabase security advisor warning).
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---- 2. Recreate every policy that referenced the public.* helpers --------

-- hub_users / module_access / grower_groups (prod hotfix policies)
drop policy if exists "Hub admins can read all hub_users" on public.hub_users;
create policy "Hub admins can read all hub_users" on public.hub_users
  for select to authenticated using (private.is_hub_admin());

drop policy if exists "Hub admins can manage hub_users" on public.hub_users;
create policy "Hub admins can manage hub_users" on public.hub_users
  for all to authenticated using (private.is_hub_admin());

drop policy if exists "Hub admins can manage module_access" on public.module_access;
create policy "Hub admins can manage module_access" on public.module_access
  for all to authenticated using (private.is_hub_admin());

drop policy if exists "Hub admins can manage grower_groups" on public.grower_groups;
create policy "Hub admins can manage grower_groups" on public.grower_groups
  for all to authenticated using (private.is_hub_admin());

-- grower_groups read (00005)
drop policy if exists "portal read grower_groups" on public.grower_groups;
create policy "portal read grower_groups" on public.grower_groups
  for select to authenticated
  using (private.portal_is_internal() or id = private.portal_group_id());

-- rcti_recipients read
drop policy if exists "portal read rcti_recipients" on public.rcti_recipients;
create policy "portal read rcti_recipients" on public.rcti_recipients
  for select to authenticated
  using (
    private.portal_is_internal()
    or (grower_group_id = private.portal_group_id()
        and (private.portal_recipient_ids() is null or id = any(private.portal_recipient_ids())))
  );

-- farms read
drop policy if exists "portal read farms" on public.farms;
create policy "portal read farms" on public.farms
  for select to authenticated
  using (
    private.portal_is_internal()
    or (grower_group_id = private.portal_group_id()
        and (private.portal_farm_ids() is null or id = any(private.portal_farm_ids())))
  );

-- Farm-axis fact tables
do $$
declare t text;
begin
  foreach t in array array[
    'ft_consignments','ft_orders','ft_pallets','ft_dispatch','ft_charges',
    'ft_stock','qa_assessments','qa_audits','documents'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'portal read '||t, t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (private.portal_is_internal() or private.portal_can_see_farm(grower_id))
    $f$, 'portal read '||t, t);
  end loop;
end $$;

-- ft_entities (join through farms by freshtrack_code)
drop policy if exists "portal read ft_entities" on public.ft_entities;
create policy "portal read ft_entities" on public.ft_entities
  for select to authenticated
  using (
    private.portal_is_internal()
    or exists (
      select 1 from farms f
      where f.freshtrack_code = ft_entities.entity_code
        and private.portal_can_see_farm(f.id)
    )
  );

-- remittances + children
drop policy if exists "portal read remittances" on public.remittances;
create policy "portal read remittances" on public.remittances
  for select to authenticated
  using (private.portal_is_internal() or private.portal_can_see_recipient(recipient_id));

drop policy if exists "portal read remittance_line_items" on public.remittance_line_items;
create policy "portal read remittance_line_items" on public.remittance_line_items
  for select to authenticated
  using (private.portal_can_see_remittance(remittance_id));

drop policy if exists "portal read remittance_charges" on public.remittance_charges;
create policy "portal read remittance_charges" on public.remittance_charges
  for select to authenticated
  using (private.portal_can_see_remittance(remittance_id));

drop policy if exists "portal read qa_category_scores" on public.qa_category_scores;
create policy "portal read qa_category_scores" on public.qa_category_scores
  for select to authenticated
  using (private.portal_can_see_assessment(assessment_id));

-- sync_logs / sync_config (internal-only)
drop policy if exists "portal internal read sync_logs" on public.sync_logs;
create policy "portal internal read sync_logs" on public.sync_logs
  for select to authenticated using (private.portal_is_internal());

drop policy if exists "portal internal read sync_config" on public.sync_config;
create policy "portal internal read sync_config" on public.sync_config
  for select to authenticated using (private.portal_is_internal());

drop policy if exists "Hub admins can manage sync_config" on public.sync_config;
create policy "Hub admins can manage sync_config" on public.sync_config
  for all to authenticated
  using (private.is_hub_admin());

-- rcti_documents
drop policy if exists "portal read rcti_documents" on public.rcti_documents;
create policy "portal read rcti_documents" on public.rcti_documents
  for select to authenticated
  using (private.portal_is_internal() or private.portal_can_see_recipient(recipient_id));

-- storage.objects (defense-in-depth from 00007)
drop policy if exists "documents bucket scoped read" on storage.objects;
create policy "documents bucket scoped read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      private.portal_is_internal()
      or (
        split_part(name, '/', 1) = 'rcti'
        and private.portal_can_see_recipient(
          nullif(split_part(name, '/', 2), '')::uuid
        )
      )
      or (
        split_part(name, '/', 1) <> 'rcti'
        and private.portal_can_see_farm(
          nullif(split_part(name, '/', 1), '')::uuid
        )
      )
    )
  );

-- ---- 3. Drop the now-unused public.* helpers ------------------------------
drop function if exists public.is_hub_admin();
drop function if exists public.portal_group_id();
drop function if exists public.portal_role();
drop function if exists public.portal_is_internal();
drop function if exists public.portal_farm_ids();
drop function if exists public.portal_recipient_ids();
drop function if exists public.portal_can_see_farm(uuid);
drop function if exists public.portal_can_see_recipient(uuid);
drop function if exists public.portal_can_see_remittance(uuid);
drop function if exists public.portal_can_see_assessment(uuid);

commit;
