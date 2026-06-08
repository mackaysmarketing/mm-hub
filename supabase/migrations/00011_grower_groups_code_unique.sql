-- =============================================================================
-- Migration 00011 — Ensure grower_groups.code has UNIQUE (prod-reproducibility)
-- =============================================================================
-- 00010's singleton-MACKM insert uses ON CONFLICT (code) DO NOTHING. Live prod
-- was created by an out-of-band hotfix (commit 338fcbd) that omitted the
-- UNIQUE that 00005's CREATE TABLE grower_groups had (`code text unique` in
-- the column declaration). Branch DBs built from the repo's migration history
-- already have it; only prod was missing it, and 00010's apply on prod failed
-- with `42P10: there is no unique or exclusion constraint matching the ON
-- CONFLICT specification`.
--
-- This migration adds the constraint idempotently so the repo reproduces prod
-- exactly, and replays on a fresh DB are a no-op.
-- =============================================================================

begin;

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class r      on r.oid = c.conrelid
      join pg_namespace n  on n.oid = r.relnamespace
     where n.nspname = 'public'
       and r.relname = 'grower_groups'
       and c.contype = 'u'
       and pg_get_constraintdef(c.oid) ilike '%(code)%'
  ) then
    -- Same SQL the prod hotfix used. Will fail loudly if duplicates exist
    -- (which would be a real data integrity issue worth surfacing).
    alter table public.grower_groups
      add constraint grower_groups_code_key unique (code);
  end if;
end $$;

commit;
