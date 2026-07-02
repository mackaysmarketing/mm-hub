-- ============================================================================
-- 00005_grower_access_claims.sql
-- Grower access claims: per-user consignor_ids / is_internal resolvers,
-- materialisation into auth.users.raw_app_meta_data, per-user freshness stamp,
-- and resync triggers.
--
-- Interface contract shared with mm-data-hub (names are fixed — see SPRINT.md):
--   public.claim_freshness (user_id, claims_updated_at)
--   private.resolve_consignor_ids(uuid) returns uuid[]
--   private.resolve_is_internal(uuid) returns boolean
--   private.sync_user_claims(uuid) returns boolean
--   private.sync_all_claims() returns integer
--
-- Resolution mirrors the existing portal_* helpers exactly:
--   active grower-portal module_access row -> config.grower_group_id -> farms
--   in group (narrowed by config.grower_ids unless role admin/staff/
--   grower_admin or grower_ids is null / not an array) -> ft_entities via
--   farms.freshtrack_entity_uuid -> distinct non-null consignor_freshtrack_id.
--   is_internal = active hub_admin OR module_role in ('admin','staff').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Freshness stamp — read by the mm-data-hub companion guard. RLS enabled
--    with zero client policies: anon/authenticated can never read or write it.
-- ----------------------------------------------------------------------------
create table public.claim_freshness (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claims_updated_at timestamptz not null
);

alter table public.claim_freshness enable row level security;
revoke all on table public.claim_freshness from anon, authenticated;

-- Advisor-hygiene no-op: service_role has bypassrls, so this policy grants
-- nothing new — it only keeps the rls_enabled_no_policy lint silent. Clients
-- (anon/authenticated) have zero applicable policies and no table privileges:
-- fail closed.
create policy claim_freshness_service_role_read
  on public.claim_freshness for select to service_role using (true);

-- ----------------------------------------------------------------------------
-- 2. Per-user resolvers
-- ----------------------------------------------------------------------------
create or replace function private.resolve_consignor_ids(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with ma as (
    select (config->>'grower_group_id')::uuid as group_id,
           module_role,
           config->'grower_ids' as grower_ids
    from public.module_access
    where user_id = p_user_id
      and module_id = 'grower-portal'
      and active = true
    limit 1
  )
  select coalesce(
    (
      select array_agg(distinct e.consignor_freshtrack_id
                       order by e.consignor_freshtrack_id)
      from ma
      join public.farms f on f.grower_group_id = ma.group_id
      join public.ft_entities e on e.freshtrack_id = f.freshtrack_entity_uuid
      where e.consignor_freshtrack_id is not null
        and (
          ma.module_role in ('admin', 'staff', 'grower_admin')
          or ma.grower_ids is null
          or jsonb_typeof(ma.grower_ids) <> 'array'
          or f.id in (select (jsonb_array_elements_text(ma.grower_ids))::uuid)
        )
    ),
    '{}'::uuid[]
  );
$$;

create or replace function private.resolve_is_internal(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.hub_users
           where id = p_user_id and active = true and hub_role = 'hub_admin'
         )
      or exists (
           select 1 from public.module_access
           where user_id = p_user_id
             and module_id = 'grower-portal'
             and active = true
             and module_role in ('admin', 'staff')
         );
$$;

-- ----------------------------------------------------------------------------
-- 3. Sync: merge computed claims into raw_app_meta_data. Writes by merge (||),
--    never replace — provider/providers survive. Writes the array key
--    consignor_ids only (legacy scalar consignor_id is never written). A user
--    with no access gets explicit consignor_ids: [] and is_internal: false.
--    The stamp advances in the same transaction, and only on real change.
-- ----------------------------------------------------------------------------
create or replace function private.sync_user_claims(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_changed boolean;
begin
  v_claims := jsonb_build_object(
    'consignor_ids', to_jsonb(private.resolve_consignor_ids(p_user_id)),
    'is_internal',   private.resolve_is_internal(p_user_id)
  );

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || v_claims
  where id = p_user_id
    and (
      raw_app_meta_data is null
      or raw_app_meta_data->'consignor_ids' is distinct from v_claims->'consignor_ids'
      or raw_app_meta_data->'is_internal'   is distinct from v_claims->'is_internal'
    );
  v_changed := found;

  if v_changed then
    insert into public.claim_freshness (user_id, claims_updated_at)
    values (p_user_id, now())
    on conflict (user_id) do update
      set claims_updated_at = excluded.claims_updated_at;
  end if;

  return v_changed;
end;
$$;

create or replace function private.sync_all_claims()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
  v_count integer := 0;
begin
  for v_user in select id from auth.users loop
    if private.sync_user_claims(v_user.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Triggers: any change to access sources re-materialises claims. Statement
--    level (user count is tiny; unchanged users' stamps never move). No
--    trigger on ft_entities — the FreshTrack entity sync ends with one
--    sync_all_claims() call instead (bulk upserts would storm a trigger).
-- ----------------------------------------------------------------------------
create or replace function private.handle_claims_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_all_claims();
  return null;
end;
$$;

create trigger sync_claims_on_module_access
  after insert or update or delete on public.module_access
  for each statement execute function private.handle_claims_change();

create trigger sync_claims_on_hub_users
  after insert or update or delete on public.hub_users
  for each statement execute function private.handle_claims_change();

create trigger sync_claims_on_farms
  after insert or update or delete on public.farms
  for each statement execute function private.handle_claims_change();

-- ----------------------------------------------------------------------------
-- 5. RPC wrapper: private is not API-exposed, so the FreshTrack sync (service
--    role via PostgREST) invokes the bulk resync through this. Service role
--    only — clients can never execute it.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_sync_all_claims()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.sync_all_claims();
$$;

-- ----------------------------------------------------------------------------
-- 6. Lock down: EXECUTE revoked from anon and authenticated on every new
--    function (and from public, which holds the default grant).
-- ----------------------------------------------------------------------------
revoke execute on function private.resolve_consignor_ids(uuid) from public, anon, authenticated;
revoke execute on function private.resolve_is_internal(uuid)   from public, anon, authenticated;
revoke execute on function private.sync_user_claims(uuid)      from public, anon, authenticated;
revoke execute on function private.sync_all_claims()           from public, anon, authenticated;
revoke execute on function private.handle_claims_change()      from public, anon, authenticated;
revoke execute on function public.rpc_sync_all_claims()        from public, anon, authenticated;
grant  execute on function public.rpc_sync_all_claims()        to service_role;

-- ----------------------------------------------------------------------------
-- 7. First materialisation for existing users (absent keys are not an
--    acceptable end state for a synced user).
-- ----------------------------------------------------------------------------
select private.sync_all_claims();
