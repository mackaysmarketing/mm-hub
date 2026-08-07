-- =============================================================================
-- Migration 00021 — Document the every_n_minutes schedule shape
-- =============================================================================
-- config.schedule gains a fourth shape, {"frequency": "every_n_minutes",
-- "n": 5..60}, so an admin can set a custom run interval from the Tools UI
-- instead of choosing between three fixed presets.
--
-- DATA CHANGE: none. config is jsonb, so the new shape needs no DDL, and every
-- schedule already stored keeps its exact meaning. This migration exists only
-- to keep the column comment — the one piece of schema-level documentation of
-- what belongs in that jsonb — from describing a shape set that no longer
-- matches lib/processes/schedule.ts.
--
-- WHY THE INTERVAL IS BOUNDED AT 5..60 AND MUST BE A MULTIPLE OF 5. Schedules
-- are not cron expressions; they are evaluated by isRunDue() on each tick of
-- the ONE physical cron in vercel.json, which this change moves from hourly
-- ("0 * * * *") to every five minutes ("*/5 * * * *"). Nothing can run more
-- often than that tick, and an interval the tick never lands on would fire on
-- the intersection of the two instead of what was asked for — n=7 under a
-- 5-minute tick means :00 and :35. parseSchedule() therefore rejects such a
-- value outright, so the settings PATCH 400s rather than storing a schedule
-- that would lie about itself.
--
-- COMPATIBILITY NOTE for anyone reading a stored schedule directly: before
-- this change a tick WAS an hour, so the "hourly" shape was due on every tick
-- unconditionally. isRunDue() now guards every hour-based shape on minute 0.
-- Without that guard the rows below would have started firing 12x an hour —
-- consignor_auto_assign_report is set to hourly in production.
-- =============================================================================

begin;

comment on column public.process_definitions.config is
  'consignor_auto_assign shape: {"schedule": {"frequency": "every_n_minutes", '
  '"n": 5} | {"frequency": "hourly"} | {"frequency": "every_n_hours", "n": 4} '
  '| {"frequency": "daily", "at_hour_brisbane": 0}, '
  '"assignable_state_codes": ["OR","FORD","Default"], '
  '"discovery_lookback_days": 3, "discovery_horizon_days": 45}. '
  'every_n_minutes.n must be a multiple of the vercel.json cron tick '
  '(5 minutes) and no greater than 60 — see lib/processes/schedule.ts.';

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   select key, config->'schedule' as schedule from process_definitions;
--   -- expect: unchanged from before this migration
--
--   select col_description('public.process_definitions'::regclass, ordinal_position)
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'process_definitions'
--     and column_name = 'config';
--   -- expect: the comment above, mentioning every_n_minutes
--
-- To set a 15-minute interval by hand (the UI is the normal route):
--   update process_definitions
--   set config = config || '{"schedule": {"frequency": "every_n_minutes", "n": 15}}'::jsonb,
--       updated_at = now()
--   where key = 'consignor_auto_assign';
-- =============================================================================
