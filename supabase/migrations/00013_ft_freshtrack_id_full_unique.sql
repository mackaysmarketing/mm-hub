-- =============================================================================
-- Migration 00013 — Convert partial UNIQUE → full UNIQUE on ft_*.freshtrack_id
-- =============================================================================
-- Background
--   Live cron 2026-06-08 (after migrations 00010..00012) returned 3 of 5 sync
--   steps with `42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification`. Reproduced on prod:
--
--     CREATE UNIQUE INDEX ft_entities_freshtrack_id_key
--       ON public.ft_entities USING btree (freshtrack_id)
--       WHERE (freshtrack_id IS NOT NULL);    -- ← PARTIAL
--
--   Postgres matches `ON CONFLICT (col)` against an index iff the index's
--   indexed expressions exactly match AND the index predicate (WHERE clause)
--   exactly matches the ON CONFLICT predicate. supabase-js sends bare
--   `.upsert([...], { onConflict: "freshtrack_id" })` — no WHERE — so the
--   partial index does NOT qualify, and Postgres reports 42P10.
--
--   Tables that already had FULL unique indexes (ft_harvest_loads,
--   ft_order_items, ft_boxes — created clean in migration 00010) work fine.
--   The broken ones (ft_entities, ft_pallets, ft_dispatch, ft_charges) were
--   created by an earlier migration vintage that used the partial form to
--   tolerate legacy rows with null freshtrack_id.
--
-- Why "full" is safe here
--   Pre-apply check on prod: ft_entities, ft_dispatch, ft_charges, ft_pallets
--   each have 0 rows. No legacy null-freshtrack_id rows to break. Even if some
--   later appear, Postgres `UNIQUE` defaults to NULLS DISTINCT (treats nulls
--   as never-equal), so multiple null freshtrack_id rows are still allowed
--   under a full unique index — no behavioural change vs. the partial form
--   for present-or-future null cases.
--
-- Scope (intentionally narrow)
--   Touches the 4 tables the cron writes to today. ft_orders has the same
--   partial-index shape but isn't currently synced — left untouched to keep
--   the change surface minimal; revisit when ft_orders sync is added.
--
-- Re-runnable
--   Each fix is bracketed by an existence check on the partial form. If the
--   index already names a full unique (re-run after success) the block is a
--   no-op. Idempotent across replays.
-- =============================================================================

begin;

do $$
declare
  v_tbl  text;
  v_idx  text;
  v_pred text;
begin
  -- Iterate the 4 known offenders. Drop the partial unique index by name,
  -- then create a full unique index in its place (same name) so downstream
  -- code referencing the constraint name still works.
  for v_tbl, v_idx in
    select unnest(array['ft_entities', 'ft_dispatch', 'ft_charges', 'ft_pallets']),
           unnest(array['ft_entities_freshtrack_id_key', 'ft_dispatch_freshtrack_id_key',
                        'ft_charges_freshtrack_id_key',  'ft_pallets_freshtrack_id_key'])
  loop
    select pg_get_expr(ix.indpred, ix.indrelid)
      into v_pred
      from pg_index ix
      join pg_class i  on i.oid = ix.indexrelid
      join pg_class c  on c.oid = ix.indrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_tbl and i.relname = v_idx;

    if v_pred is not null then
      -- Index exists AND is partial → drop + recreate as full.
      execute format('drop index public.%I', v_idx);
      execute format('create unique index %I on public.%I (freshtrack_id)', v_idx, v_tbl);
    elsif v_pred is null and exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_idx
    ) then
      -- Already full unique (re-run) → no-op.
      null;
    else
      -- Index doesn't exist at all → create it full.
      execute format('create unique index %I on public.%I (freshtrack_id)', v_idx, v_tbl);
    end if;
  end loop;
end $$;

commit;

-- =============================================================================
-- Verification (run as service_role / postgres after apply):
--
--   select c.relname as tbl, i.relname as index_name,
--          pg_get_expr(ix.indpred, ix.indrelid) as where_clause
--     from pg_index ix
--     join pg_class c on c.oid = ix.indrelid
--     join pg_class i on i.oid = ix.indexrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and i.relname in ('ft_entities_freshtrack_id_key',
--                        'ft_dispatch_freshtrack_id_key',
--                        'ft_charges_freshtrack_id_key',
--                        'ft_pallets_freshtrack_id_key')
--    order by c.relname;
--   -- expected: all 4 rows have where_clause IS NULL (i.e. fully unique).
-- =============================================================================
