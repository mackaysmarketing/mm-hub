-- ============================================================================
-- verify_grower_claims.sql
-- End-to-end verification of the grower access claims sprint (SPRINT.md
-- criteria 2-8 and 11-12), including disposable-test-user setup and teardown.
--
-- Run with:  psql "$DATABASE_URL" -f scripts/verify_grower_claims.sql
-- Idempotent: safe to run repeatedly. Fails loudly (non-zero exit) on any
-- assertion failure via pg_temp.assert + ON_ERROR_STOP.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

\echo '======================================================================'
\echo ' MM-Hub grower access claims verification (criteria 2-8, 11-12)'
\echo '======================================================================'

-- Fixtures (verified live-state facts, SPRINT.md 2026-07-02)
\set U_ADMIN      'ec39ed22-0590-4536-9622-42991e526255'
\set U_GROWER     'f965b438-4982-465b-ae6e-e29493c70f2f'
\set GROUP_MM     'bffbebbe-8c22-4f5d-8205-c9d481d8a956'
\set FARM_TEST01  'f625e8a0-c20f-4b52-933b-42145692d555'
\set U_TEST       'aaaaaaaa-0000-4000-8000-000000000001'

create or replace function pg_temp.assert(p_ok boolean, p_label text)
returns text language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
  return 'PASS: ' || p_label;
end $$;

-- ----------------------------------------------------------------------------
-- Setup: teardown-first (idempotency), then create the disposable test user.
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- Setup: disposable test user (teardown-first for idempotency) ---'
delete from public.module_access where user_id = :'U_TEST';
delete from public.hub_users     where id      = :'U_TEST';
delete from auth.users           where id      = :'U_TEST';

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', :'U_TEST', 'authenticated',
   'authenticated', 'claims-verify-disposable@example.invalid',
   extensions.crypt('Disposable-Claims-Verify-1!', extensions.gen_salt('bf')),
   now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());

insert into public.hub_users (id, name, email, auth_provider, hub_role, active)
values (:'U_TEST', 'Claims Verify (disposable)',
        'claims-verify-disposable@example.invalid', 'email', 'user', true);

-- Two deterministic fixture farms from group Mackays Marketing (for narrowing)
drop table if exists _fix;
create temp table _fix as
select f.id as farm_id, f.code, e.consignor_freshtrack_id as consignor_id
from public.farms f
join public.ft_entities e on e.freshtrack_id = f.freshtrack_entity_uuid
where f.grower_group_id = :'GROUP_MM'
  and e.consignor_freshtrack_id is not null
order by f.id
limit 2;

\echo 'Fixture farms used for narrowing:'
select * from _fix order by farm_id;
select pg_temp.assert((select count(*) = 2 from _fix), 'setup: two fixture farms found');

-- ----------------------------------------------------------------------------
-- AC2: resolver is set-equal to the canonical chain, cardinality > 0
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC2: resolver vs canonical chain (grower_admin user) ---'
with resolver as (
  select unnest(private.resolve_consignor_ids(:'U_GROWER')) as cid
),
canonical as (
  select distinct e.consignor_freshtrack_id as cid
  from public.farms f
  join public.ft_entities e on e.freshtrack_id = f.freshtrack_entity_uuid
  where f.grower_group_id = :'GROUP_MM'
    and e.consignor_freshtrack_id is not null
)
select (select count(*) from resolver)  as resolver_count,
       (select count(*) from canonical) as canonical_count,
       not exists (select cid from resolver except select cid from canonical)
   and not exists (select cid from canonical except select cid from resolver)
                                        as set_equal;
with resolver as (
  select unnest(private.resolve_consignor_ids(:'U_GROWER')) as cid
),
canonical as (
  select distinct e.consignor_freshtrack_id as cid
  from public.farms f
  join public.ft_entities e on e.freshtrack_id = f.freshtrack_entity_uuid
  where f.grower_group_id = :'GROUP_MM'
    and e.consignor_freshtrack_id is not null
)
select (select count(*) from resolver)  as resolver_count,
       (select count(*) from canonical) as canonical_count,
       not exists (select cid from resolver except select cid from canonical)
   and not exists (select cid from canonical except select cid from resolver)
                                        as set_equal
\gset AC2_
select pg_temp.assert(:'AC2_set_equal'::boolean and :AC2_resolver_count > 0
                      and :AC2_resolver_count = :AC2_canonical_count,
                      'AC2 resolver set-equal to canonical chain, count > 0');

-- ----------------------------------------------------------------------------
-- AC3: named exclusion — TEST01 is in the group but contributes nothing
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC3: TEST01 exclusion ---'
select f.id, f.code, f.name,
       f.grower_group_id = :'GROUP_MM'::uuid as in_group_mackays_marketing,
       f.freshtrack_entity_uuid,
       exists (select 1 from public.ft_entities e
               where e.freshtrack_id = f.freshtrack_entity_uuid
                 and e.consignor_freshtrack_id is not null) as contributes_consignor
from public.farms f
where f.id = :'FARM_TEST01';
select pg_temp.assert(
  (select f.grower_group_id = :'GROUP_MM'::uuid
      and not exists (select 1 from public.ft_entities e
                      where e.freshtrack_id = f.freshtrack_entity_uuid
                        and e.consignor_freshtrack_id is not null)
   from public.farms f where f.id = :'FARM_TEST01'),
  'AC3 TEST01 is in group Mackays Marketing yet contributes no consignor');

-- ----------------------------------------------------------------------------
-- AC4: narrowing semantics
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC4: grower role narrowed to two farms ---'
insert into public.module_access (user_id, module_id, module_role, active, config)
values (:'U_TEST', 'grower-portal', 'grower', true,
        jsonb_build_object(
          'grower_group_id', :'GROUP_MM',
          'grower_ids', (select jsonb_agg(farm_id order by farm_id) from _fix)));

select private.resolve_consignor_ids(:'U_TEST') as narrowed_resolver_output;
select pg_temp.assert(
  private.resolve_consignor_ids(:'U_TEST')
    = (select array_agg(consignor_id order by consignor_id) from _fix),
  'AC4 grower role with grower_ids returns exactly the two fixture consignors');

\echo '--- AC4: grower_admin role ignores grower_ids ---'
update public.module_access set module_role = 'grower_admin'
where user_id = :'U_TEST' and module_id = 'grower-portal';

select coalesce(array_length(private.resolve_consignor_ids(:'U_TEST'), 1), 0)
       as grower_admin_resolver_count;
select pg_temp.assert(
  coalesce(array_length(private.resolve_consignor_ids(:'U_TEST'), 1), 0)
    = :AC2_canonical_count,
  'AC4 grower_admin ignores grower_ids (returns the full group set)');

-- revert to narrowed grower role for the remaining criteria
update public.module_access set module_role = 'grower'
where user_id = :'U_TEST' and module_id = 'grower-portal';

-- ----------------------------------------------------------------------------
-- AC5: is_internal correct and in parity with portal_is_internal()
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC5: resolve_is_internal fixture values ---'
select private.resolve_is_internal(:'U_ADMIN')  as hub_admin_is_internal,
       private.resolve_is_internal(:'U_GROWER') as grower_admin_is_internal;
select pg_temp.assert(
  private.resolve_is_internal(:'U_ADMIN')
  and not private.resolve_is_internal(:'U_GROWER'),
  'AC5 is_internal true for hub_admin, false for grower_admin');

\echo '--- AC5: parity with portal_is_internal() (hub_admin user) ---'
begin;
select set_config('request.jwt.claims',
       json_build_object('sub', :'U_ADMIN', 'role', 'authenticated')::text,
       true) as jwt_claims_set;
select private.portal_is_internal()              as portal_is_internal,
       private.resolve_is_internal(auth.uid())   as resolve_is_internal,
       private.portal_is_internal() = private.resolve_is_internal(auth.uid())
                                                 as parity;
select private.portal_is_internal() = private.resolve_is_internal(auth.uid())
       as parity \gset AC5_ADMIN_
rollback;

\echo '--- AC5: parity with portal_is_internal() (grower_admin user) ---'
begin;
select set_config('request.jwt.claims',
       json_build_object('sub', :'U_GROWER', 'role', 'authenticated')::text,
       true) as jwt_claims_set;
select private.portal_is_internal()              as portal_is_internal,
       private.resolve_is_internal(auth.uid())   as resolve_is_internal,
       private.portal_is_internal() = private.resolve_is_internal(auth.uid())
                                                 as parity;
select private.portal_is_internal() = private.resolve_is_internal(auth.uid())
       as parity \gset AC5_GROWER_
rollback;

select pg_temp.assert(:'AC5_ADMIN_parity'::boolean and :'AC5_GROWER_parity'::boolean,
                      'AC5 portal_is_internal() parity for both users');

-- ----------------------------------------------------------------------------
-- AC6: materialisation merges, never clobbers
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC6: provider/providers before sync ---'
select id, email, raw_app_meta_data->>'provider'        as provider_before,
       (raw_app_meta_data->'providers')::text           as providers_before,
       raw_app_meta_data ? 'consignor_id'               as has_legacy_scalar_key
from auth.users where id in (:'U_ADMIN', :'U_GROWER') order by email;

select raw_app_meta_data->>'provider' as p, (raw_app_meta_data->'providers')::text as ps
from auth.users where id = :'U_ADMIN' \gset AC6_ADMIN_B_
select raw_app_meta_data->>'provider' as p, (raw_app_meta_data->'providers')::text as ps
from auth.users where id = :'U_GROWER' \gset AC6_GROWER_B_

\echo '--- AC6: sync both real users ---'
select private.sync_user_claims(:'U_ADMIN')  as hub_admin_changed,
       private.sync_user_claims(:'U_GROWER') as grower_admin_changed;

\echo '--- AC6: raw_app_meta_data after sync ---'
select id, email,
       raw_app_meta_data->'consignor_ids'      as consignor_ids,
       raw_app_meta_data->'is_internal'        as is_internal,
       raw_app_meta_data->>'provider'          as provider_after,
       (raw_app_meta_data->'providers')::text  as providers_after,
       raw_app_meta_data ? 'consignor_id'      as has_legacy_scalar_key
from auth.users where id in (:'U_ADMIN', :'U_GROWER') order by email;

select pg_temp.assert(
  (select raw_app_meta_data->>'provider' = :'AC6_ADMIN_B_p'
      and (raw_app_meta_data->'providers')::text = :'AC6_ADMIN_B_ps'
   from auth.users where id = :'U_ADMIN'),
  'AC6 hub_admin provider/providers byte-identical to before');
select pg_temp.assert(
  (select raw_app_meta_data->>'provider' = :'AC6_GROWER_B_p'
      and (raw_app_meta_data->'providers')::text = :'AC6_GROWER_B_ps'
   from auth.users where id = :'U_GROWER'),
  'AC6 grower_admin provider/providers byte-identical to before');
select pg_temp.assert(
  (select raw_app_meta_data->'consignor_ids' = '[]'::jsonb
      and raw_app_meta_data->'is_internal' = 'true'::jsonb
      and not raw_app_meta_data ? 'consignor_id'
   from auth.users where id = :'U_ADMIN'),
  'AC6 hub_admin: consignor_ids = [], is_internal = true, no scalar key');
select pg_temp.assert(
  (select jsonb_typeof(raw_app_meta_data->'consignor_ids') = 'array'
      and raw_app_meta_data->'consignor_ids'
            = to_jsonb(private.resolve_consignor_ids(:'U_GROWER'))
      and raw_app_meta_data->'is_internal' = 'false'::jsonb
      and not raw_app_meta_data ? 'consignor_id'
   from auth.users where id = :'U_GROWER'),
  'AC6 grower_admin: consignor_ids = full array, is_internal = false, no scalar key');

-- ----------------------------------------------------------------------------
-- AC7a: revocation advances the stamp
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC7a: stamp before revocation (test user) ---'
select claims_updated_at as stamp_before from public.claim_freshness
where user_id = :'U_TEST';
select claims_updated_at as stamp_before from public.claim_freshness
where user_id = :'U_TEST' \gset AC7_

update public.module_access set active = false
where user_id = :'U_TEST' and module_id = 'grower-portal';

\echo '--- AC7a: claims + stamp after revocation ---'
select u.raw_app_meta_data->'consignor_ids' as consignor_ids,
       u.raw_app_meta_data->'is_internal'   as is_internal,
       cf.claims_updated_at                 as stamp_after
from auth.users u
join public.claim_freshness cf on cf.user_id = u.id
where u.id = :'U_TEST';
select claims_updated_at as stamp_after from public.claim_freshness
where user_id = :'U_TEST' \gset AC7_

select pg_temp.assert(
  (select raw_app_meta_data->'consignor_ids' = '[]'::jsonb
      and raw_app_meta_data->'is_internal' = 'false'::jsonb
   from auth.users where id = :'U_TEST')
  and :'AC7_stamp_after'::timestamptz > :'AC7_stamp_before'::timestamptz,
  'AC7a revocation -> consignor_ids [], is_internal false, stamp advanced');

-- ----------------------------------------------------------------------------
-- AC7b: no-op sync moves nothing
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC7b: sync_all_claims() twice consecutively ---'
select private.sync_all_claims() as first_run;
select max(claims_updated_at) as max_stamp_after_first_run
from public.claim_freshness;
select max(claims_updated_at) as m from public.claim_freshness \gset AC7B_MID_
select private.sync_all_claims() as second_run;
select private.sync_all_claims() as second_run_again \gset AC7B_
select max(claims_updated_at) as max_stamp_after_second_run
from public.claim_freshness;
select max(claims_updated_at) as m from public.claim_freshness \gset AC7B_AFTER_
select pg_temp.assert(
  :AC7B_second_run_again = 0
  and :'AC7B_AFTER_m'::timestamptz = :'AC7B_MID_m'::timestamptz,
  'AC7b second run returns 0 and max(claims_updated_at) unchanged');

-- ----------------------------------------------------------------------------
-- AC8: all four trigger paths (no explicit sync calls below)
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC8a: UPDATE module_access (re-activate) -> read-back ---'
update public.module_access set active = true
where user_id = :'U_TEST' and module_id = 'grower-portal';
select raw_app_meta_data->'consignor_ids' as consignor_ids,
       raw_app_meta_data->'is_internal'   as is_internal
from auth.users where id = :'U_TEST';
select pg_temp.assert(
  (select raw_app_meta_data->'consignor_ids'
            = (select to_jsonb(array_agg(consignor_id order by consignor_id)) from _fix)
      and raw_app_meta_data->'is_internal' = 'false'::jsonb
   from auth.users where id = :'U_TEST'),
  'AC8a module_access UPDATE trigger re-materialised the narrowed set');

\echo '--- AC8b: UPDATE hub_users (promote to hub_admin) -> read-back ---'
update public.hub_users set hub_role = 'hub_admin' where id = :'U_TEST';
select raw_app_meta_data->'is_internal' as is_internal_after_promote
from auth.users where id = :'U_TEST';
select pg_temp.assert(
  (select raw_app_meta_data->'is_internal' = 'true'::jsonb
   from auth.users where id = :'U_TEST'),
  'AC8b hub_users UPDATE trigger set is_internal true');

update public.hub_users set hub_role = 'user' where id = :'U_TEST';
select raw_app_meta_data->'is_internal' as is_internal_after_demote
from auth.users where id = :'U_TEST';
select pg_temp.assert(
  (select raw_app_meta_data->'is_internal' = 'false'::jsonb
   from auth.users where id = :'U_TEST'),
  'AC8b hub_users UPDATE trigger set is_internal back to false');

\echo '--- AC8c: UPDATE farms.grower_group_id -> read-back (txn-guarded) ---'
begin;
update public.farms set grower_group_id = null
where id = (select farm_id from _fix order by farm_id limit 1);
select (raw_app_meta_data->'consignor_ids')::text as ids from auth.users
where id = :'U_TEST' \gset AC8C_MOVED_
update public.farms set grower_group_id = :'GROUP_MM'
where id = (select farm_id from _fix order by farm_id limit 1);
select (raw_app_meta_data->'consignor_ids')::text as ids from auth.users
where id = :'U_TEST' \gset AC8C_RESTORED_
commit;
select :'AC8C_MOVED_ids'    as consignor_ids_after_farm_moved_out,
       :'AC8C_RESTORED_ids' as consignor_ids_after_farm_restored;
select pg_temp.assert(
  :'AC8C_MOVED_ids'::jsonb
    = (select to_jsonb(array_agg(consignor_id order by consignor_id))
       from _fix where farm_id <> (select farm_id from _fix order by farm_id limit 1))
  and :'AC8C_RESTORED_ids'::jsonb
    = (select to_jsonb(array_agg(consignor_id order by consignor_id)) from _fix),
  'AC8c farms UPDATE trigger narrowed then restored the set');
select pg_temp.assert(
  (select count(*) = 2 from public.farms f join _fix x on x.farm_id = f.id
   where f.grower_group_id = :'GROUP_MM'::uuid),
  'AC8c fixture farms restored to group (live data unchanged)');

\echo '--- AC8d: DELETE module_access -> read-back ---'
delete from public.module_access
where user_id = :'U_TEST' and module_id = 'grower-portal';
select raw_app_meta_data->'consignor_ids' as consignor_ids,
       raw_app_meta_data->'is_internal'   as is_internal
from auth.users where id = :'U_TEST';
select pg_temp.assert(
  (select raw_app_meta_data->'consignor_ids' = '[]'::jsonb
      and raw_app_meta_data->'is_internal' = 'false'::jsonb
   from auth.users where id = :'U_TEST'),
  'AC8d module_access DELETE trigger emptied the claims');

-- ----------------------------------------------------------------------------
-- AC11: warehouse-door probes (raw.ft_dispatch_load under authenticated)
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC11a: superuser-side filtered count ---'
select count(*) as superuser_filtered_count
from raw.ft_dispatch_load
where consignor_id = any (private.resolve_consignor_ids(:'U_GROWER'));
select count(*) as n from raw.ft_dispatch_load
where consignor_id = any (private.resolve_consignor_ids(:'U_GROWER')) \gset AC11_SUPER_

begin;
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', :'U_GROWER', 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'consignor_ids', to_jsonb(private.resolve_consignor_ids(:'U_GROWER')),
      'is_internal', false))::text,
  true) as jwt_claims_set;
set local role authenticated;
select count(*) as n from raw.ft_dispatch_load \gset AC11_DOOR_
rollback;
\echo '--- AC11a: door count with grower_admin claims ---'
select :AC11_DOOR_n as door_count_with_grower_claims;
select pg_temp.assert(:AC11_DOOR_n = :AC11_SUPER_n and :AC11_DOOR_n > 0,
  'AC11a door count equals superuser filtered count and is > 0');

begin;
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', :'U_GROWER', 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'consignor_ids', jsonb_build_array(),
      'is_internal', false))::text,
  true) as jwt_claims_set;
set local role authenticated;
select count(*) as n from raw.ft_dispatch_load \gset AC11_EMPTY_
rollback;
\echo '--- AC11b: door count with empty consignor_ids ---'
select :AC11_EMPTY_n as door_count_with_empty_claims;
select pg_temp.assert(:AC11_EMPTY_n = 0, 'AC11b empty claims -> 0 rows');

begin;
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', :'U_GROWER', 'role', 'authenticated',
    'user_metadata', jsonb_build_object(
      'consignor_ids', to_jsonb(private.resolve_consignor_ids(:'U_GROWER')),
      'is_internal', true))::text,
  true) as jwt_claims_set;
set local role authenticated;
select count(*) as n from raw.ft_dispatch_load \gset AC11_POISON_
rollback;
\echo '--- AC11c: door count with set under user_metadata only (poison) ---'
select :AC11_POISON_n as door_count_with_user_metadata_poison;
select pg_temp.assert(:AC11_POISON_n = 0, 'AC11c user_metadata poison -> 0 rows');

-- ----------------------------------------------------------------------------
-- AC12: security hygiene of all new functions
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- AC12: prosecdef, search_path, and client EXECUTE on new functions ---'
select n.nspname || '.' || p.proname as func,
       p.prosecdef,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'private' and p.proname in
        ('resolve_consignor_ids', 'resolve_is_internal',
         'sync_user_claims', 'sync_all_claims', 'handle_claims_change'))
   or (n.nspname = 'public' and p.proname = 'rpc_sync_all_claims')
order by 1;
select pg_temp.assert(
  (select count(*) = 6
      and bool_and(p.prosecdef)
      and bool_and(array_to_string(p.proconfig, ',') like '%search_path=%')
      and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
      and bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'private' and p.proname in
           ('resolve_consignor_ids', 'resolve_is_internal',
            'sync_user_claims', 'sync_all_claims', 'handle_claims_change'))
      or (n.nspname = 'public' and p.proname = 'rpc_sync_all_claims')),
  'AC12 all 6 new functions: SECURITY DEFINER, pinned search_path, no client EXECUTE');

\echo '--- AC12: claim_freshness RLS enabled, zero client-applicable policies ---'
select relrowsecurity as rls_enabled from pg_class
where oid = 'public.claim_freshness'::regclass;
select policyname, roles, cmd, qual from pg_policies
where schemaname = 'public' and tablename = 'claim_freshness';
-- The only policy is a service_role no-op (service_role has bypassrls); zero
-- policies apply to anon/authenticated/public, and their table privileges are
-- revoked: clients can never read or write claim_freshness.
select pg_temp.assert(
  (select relrowsecurity from pg_class where oid = 'public.claim_freshness'::regclass)
  and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'claim_freshness'
      and roles && array['anon', 'authenticated', 'public']::name[])
  and not has_table_privilege('anon', 'public.claim_freshness', 'select')
  and not has_table_privilege('authenticated', 'public.claim_freshness', 'select'),
  'AC12 claim_freshness: RLS enabled, fail closed for clients');

-- ----------------------------------------------------------------------------
-- Teardown: remove the disposable test user and all its rows
-- ----------------------------------------------------------------------------
\echo ''
\echo '--- Teardown: disposable test user ---'
delete from public.module_access where user_id = :'U_TEST';
delete from public.hub_users     where id      = :'U_TEST';
delete from auth.users           where id      = :'U_TEST';

select (select count(*) from auth.users            where id      = :'U_TEST')
     + (select count(*) from public.hub_users      where id      = :'U_TEST')
     + (select count(*) from public.module_access  where user_id = :'U_TEST')
     + (select count(*) from public.claim_freshness where user_id = :'U_TEST')
       as test_user_rows_remaining;
select pg_temp.assert(
  (select count(*) from auth.users            where id      = :'U_TEST')
+ (select count(*) from public.hub_users      where id      = :'U_TEST')
+ (select count(*) from public.module_access  where user_id = :'U_TEST')
+ (select count(*) from public.claim_freshness where user_id = :'U_TEST') = 0,
  'teardown: test user and all its rows are gone');

\echo ''
\echo '======================================================================'
\echo ' ALL ASSERTIONS PASSED — grower access claims verified end to end'
\echo '======================================================================'
