-- =============================================================================
-- Migration 00012 — Public wrappers for FreshTrack concurrency RPCs
-- =============================================================================
-- Background
--   00009 moved every SECURITY DEFINER helper out of `public` into `private` to
--   close the Supabase advisor that flagged them as RPC-callable by
--   authenticated. `private` is intentionally NOT in PostgREST's `db-schemas`
--   list, so it cannot be reached by any role via /rest/v1/rpc/* or
--   /rest/v1/<table>.
--
--   00010 added `private.claim_freshtrack_run()` and
--   `private.release_freshtrack_run(...)` for the sync orchestrator (advisory
--   lock + sync_logs single-txn book-keeping). The cron route calls them via
--   `admin.rpc("claim_freshtrack_run")` — supabase-js routes through PostgREST,
--   which resolves to `public.claim_freshtrack_run` and 404s. Live confirmed on
--   prod 2026-06-08: the route returns 500 `{"reason":"claim failed"}` at line
--   82 before any FT work happens.
--
-- Why public wrappers (rather than re-exposing `private`)
--   * Re-adding `private` to db-schemas would restore the very advisor 00009
--     closed (any /rest/v1/rpc/<func> would route there, then function-level
--     grants would gate execution — but the advisor doesn't trust grants alone
--     for SECURITY DEFINER fns in client-reachable schemas).
--   * Public wrappers keep `private` schema un-routable. The wrappers themselves
--     are tiny pass-throughs with `revoke from public/anon/authenticated` and
--     `grant to service_role` only, so PostgREST returns 401 on every non-cron
--     caller. The actual privileged work still happens inside `private`.
--
-- Scope of this migration (deliberately narrow)
--   * Wraps the 2 RPCs the cron route invokes today: claim + release.
--   * Does NOT wrap `private.get_freshtrack_token()` — the transport's
--     `.schema("private").from("freshtrack_auth_cache")` cache reads/writes
--     fail silently (`.catch(()=>{})`) and degrade to module-level token cache;
--     cross-instance cache is a future-optimisation, not a correctness gap.
--   * Does NOT wrap `private.ft_classify_entity(...)` — classification runs in
--     TypeScript via `lib/freshtrack/classify.ts`; the SQL helper is unused by
--     the current sync code (kept for future SQL-side use).
--
-- Re-runnable / idempotent: `create or replace function` + idempotent grants.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. public.claim_freshtrack_run() — pass-through to private.claim_freshtrack_run()
-- ---------------------------------------------------------------------------
-- Returns: uuid (the new run_id) or null if another run is already in flight /
--          advisory lock taken.
create or replace function public.claim_freshtrack_run()
returns uuid
language sql
security definer
set search_path = private, public
as $$
  select private.claim_freshtrack_run();
$$;

revoke all on function public.claim_freshtrack_run() from public;
revoke all on function public.claim_freshtrack_run() from anon;
revoke all on function public.claim_freshtrack_run() from authenticated;
grant execute on function public.claim_freshtrack_run() to service_role;

comment on function public.claim_freshtrack_run() is
  'PostgREST-routable wrapper for private.claim_freshtrack_run(). service_role only. See migration 00012.';

-- ---------------------------------------------------------------------------
-- 2. public.release_freshtrack_run(uuid, text, integer, text) — pass-through
-- ---------------------------------------------------------------------------
-- Finalises the sync_logs row + releases the advisory lock.
create or replace function public.release_freshtrack_run(
  p_run_id  uuid,
  p_status  text,
  p_records integer,
  p_error   text
)
returns void
language sql
security definer
set search_path = private, public
as $$
  select private.release_freshtrack_run(p_run_id, p_status, p_records, p_error);
$$;

revoke all on function public.release_freshtrack_run(uuid, text, integer, text) from public;
revoke all on function public.release_freshtrack_run(uuid, text, integer, text) from anon;
revoke all on function public.release_freshtrack_run(uuid, text, integer, text) from authenticated;
grant execute on function public.release_freshtrack_run(uuid, text, integer, text) to service_role;

comment on function public.release_freshtrack_run(uuid, text, integer, text) is
  'PostgREST-routable wrapper for private.release_freshtrack_run(...). service_role only. See migration 00012.';

commit;

-- =============================================================================
-- Verification snippets (run as service_role / postgres after apply):
--
--   -- 1. Functions exist in public + grants are correct
--   select n.nspname as schema,
--          p.proname as func,
--          pg_get_function_identity_arguments(p.oid) as args,
--          (select string_agg(r.rolname, ',' order by r.rolname)
--             from aclexplode(p.proacl) a
--             join pg_roles r on r.oid = a.grantee
--            where a.privilege_type = 'EXECUTE') as exec_grantees
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('claim_freshtrack_run','release_freshtrack_run');
--   -- expected: exec_grantees contains 'service_role', NOT anon/authenticated.
--
--   -- 2. PostgREST will now route /rest/v1/rpc/claim_freshtrack_run as service_role
--   --    (no permission denied), but reject anon/authenticated with HTTP 403.
-- =============================================================================
