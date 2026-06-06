-- =============================================================================
-- MM-Hub Migration 00008 — Rename `growers` → `farms`
-- =============================================================================
-- The table has always meant "farm" (a FreshTrack production entity) in the
-- two-axis model; the legacy "grower" name conflates with the financial axis
-- (RCTI recipient = who Mackays pays) and was called out in the review as a
-- latent bug source ("grower" meant three different things at different layers).
--
-- Strategy:
--   1. ALTER TABLE growers RENAME TO farms — preserves FKs (they reference by
--      OID, not name), preserves data, preserves the policies (they move with
--      the table).
--   2. Recreate SECURITY DEFINER helpers referencing `farms` directly.
--   3. Keep a backward-compatible `growers` view so app code that still calls
--      .from("growers") continues to work during the gradual rename. The view
--      is simple (SELECT *) so Postgres auto-updates INSERT/UPDATE through it.
--
-- Column names (grower_group_id, grower_id on fact tables) intentionally NOT
-- renamed — that would cascade into the JSON config schema (module_access.
-- config.grower_ids, grower_group_id) used in production, the API contract,
-- and every grep across the codebase. A future targeted migration can do the
-- column rename if the value justifies the churn.
-- =============================================================================

begin;

-- 1. The rename.
alter table public.growers rename to farms;

-- Rename the indexes for cosmetic consistency (constraints/FKs keep working
-- regardless — Postgres tracks them by OID).
alter index if exists idx_growers_group rename to idx_farms_group;
alter index if exists idx_growers_recipient rename to idx_farms_recipient;
alter index if exists growers_pkey rename to farms_pkey;
alter index if exists growers_code_key rename to farms_code_key;
alter index if exists growers_freshtrack_code_key rename to farms_freshtrack_code_key;

-- 2. Recreate the SECURITY DEFINER helpers against the new table name.
create or replace function public.portal_can_see_farm(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from farms f
    where f.id = p_farm_id
      and f.grower_group_id = public.portal_group_id()
      and (public.portal_farm_ids() is null or f.id = any(public.portal_farm_ids()))
  )
$$;

-- 3. Backward-compatible view so app code still using `.from("growers")` keeps
--    working. WITH (security_invoker = true) is CRITICAL — without it, RLS on
--    the underlying `farms` table is evaluated as the view owner (typically
--    postgres / superuser), which BYPASSES tenant isolation entirely. A
--    SELECT * view is auto-updatable in Postgres, so writes from the
--    FreshTrack sync (which currently writes to "growers") continue to work.
--    Drop this view once all callers are migrated.
create or replace view public.growers with (security_invoker = true) as
  select * from public.farms;
grant select on public.growers to authenticated;
grant all on public.growers to service_role;

-- The ft_entities policy joins by farm.freshtrack_code — recreate against the
-- new table name (the old definition referenced "growers g").
drop policy if exists "portal read ft_entities" on public.ft_entities;
create policy "portal read ft_entities" on public.ft_entities
  for select to authenticated
  using (
    public.portal_is_internal()
    or exists (
      select 1 from farms f
      where f.freshtrack_code = ft_entities.entity_code
        and public.portal_can_see_farm(f.id)
    )
  );

-- The "portal read growers" policy (on the now-renamed table) needs renaming
-- too so it's not misleadingly labelled. The USING clause is unchanged.
alter policy "portal read growers" on public.farms rename to "portal read farms";

commit;
