-- =============================================================================
-- Migration 00017 — Process automation substrate + Auto FT Consignor Update
-- =============================================================================
-- Generic scaffolding (process_definitions / process_runs / process_actions) for
-- admin-configurable background processes, plus the first concrete process:
-- consignor_auto_assign ("Auto FT Consignor Update" in the UI).
--
-- Design: C:\dev\Toolkit\docs\consignor-auto-assign-design.md, §5/§6/§7.
--
-- WHAT THE PROCESS ACTUALLY DOES (confirmed 2026-07-30, live-tested on real
-- order 5024318): fills a BLANK consignor on newly-arrived orders for known
-- customers. It never touches an order that already has a consignor set. See
-- §3.0 of the design doc for how an earlier assumption (orders always have a
-- consignor) turned out to be a sync-timing artifact, not reality.
--
-- LOCKING: deliberately NOT the session-scoped pg_advisory_lock pattern the
-- existing FreshTrack cron uses (private.claim_freshtrack_run) — that
-- mechanism is unsound under Supabase's connection pooler (tracked
-- separately; one stale run row was reused by every nightly sync for weeks).
-- Mutual exclusion here is a plain UNIQUE partial index on
-- process_runs(process_key) WHERE status = 'running'. Postgres enforces this
-- as a constraint, not a session lock, so it is correct regardless of which
-- pooled connection claims or releases it. The application-level "claim" is
-- just an INSERT that either succeeds or hits a unique-violation (23505) —
-- see lib/processes/runner.ts. A stale-run reaper (>15 min old) still runs
-- before each claim attempt as a backstop for a lambda that was killed
-- mid-run without releasing.
--
-- SAFE-BY-DEFAULT: consignor_auto_assign is seeded DISABLED and in dry_run
-- mode. Nothing runs, and nothing writes to FreshTrack, until an admin
-- explicitly turns it on via the Tools UI.
-- =============================================================================

begin;

-- ---------------------------------------------------------- generic substrate
create table public.process_definitions (
  key            text primary key,               -- 'consignor_auto_assign'
  name           text not null,                  -- 'Auto FT Consignor Update'
  description    text,
  enabled        boolean not null default false,
  mode           text not null default 'dry_run'
                 check (mode in ('dry_run','apply')),
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.process_definitions is
  'One row per admin-configurable background process. The "Tools" section of '
  'the Hub reads/writes these rows; app/api/cron/processes ticks hourly and '
  'runs whichever ones are enabled and due per their own config.schedule.';

comment on column public.process_definitions.config is
  'consignor_auto_assign shape: {"schedule": {"frequency": "hourly"} | '
  '{"frequency": "every_n_hours", "n": 4} | {"frequency": "daily", '
  '"at_hour_brisbane": 0}, "assignable_state_codes": ["OR","FORD","Default"], '
  '"discovery_lookback_days": 3, "discovery_horizon_days": 45}';

create table public.process_runs (
  id               uuid primary key default gen_random_uuid(),
  process_key      text not null references public.process_definitions(key),
  trigger          text not null check (trigger in ('cron','manual')),
  triggered_by     uuid references public.hub_users(id),   -- set when trigger='manual'
  mode             text not null check (mode in ('dry_run','apply')),
  status           text not null
                   check (status in ('running','success','partial','failed','skipped_locked')),
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  candidates_seen  int not null default 0,
  actions_proposed int not null default 0,
  actions_applied  int not null default 0,
  actions_skipped  int not null default 0,
  actions_failed   int not null default 0,
  error            text,
  payload          jsonb                          -- graphql_calls, discovery window, rule count
);

-- The actual mutual-exclusion mechanism — see header note. One running row
-- per process at a time, enforced by Postgres, not by session state.
create unique index process_runs_one_running_per_process
  on public.process_runs (process_key) where status = 'running';

create index on public.process_runs (process_key, started_at desc);

create table public.process_actions (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.process_runs(id) on delete cascade,
  process_key    text not null,
  target_type    text not null,                  -- 'freshtrack_order'
  target_id      uuid not null,                   -- FreshTrack order id
  target_ref     text,                            -- orderNo, for humans
  consignee_name text,                            -- denormalised so a row reads standalone
  action         text not null,                   -- 'set_consignor'
  status         text not null
                 check (status in ('proposed','applied','skipped','failed')),
  skip_reason    text,
  rule_id        uuid,
  before         jsonb not null,                  -- always {"consignor_ft_id": null} for
                                                    -- consignor_auto_assign — kept generic
                                                    -- for any future process with real state
  after          jsonb not null,                  -- {consignor_ft_id, code, name}
  error          text,
  applied_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index on public.process_actions (run_id, status);
create index on public.process_actions (target_id, created_at desc);
create index on public.process_actions (process_key, created_at desc);

alter table public.process_definitions enable row level security;
alter table public.process_runs        enable row level security;
alter table public.process_actions     enable row level security;

-- service_role bypasses RLS; these policies exist only to silence the
-- rls_enabled_no_policy advisor lint, matching the pattern already used for
-- claim_freshness in 00015.
create policy process_definitions_service_role_all on public.process_definitions
  for all to service_role using (true) with check (true);
create policy process_runs_service_role_all on public.process_runs
  for all to service_role using (true) with check (true);
create policy process_actions_service_role_all on public.process_actions
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------- consignor_auto_assign
create table public.consignor_assignment_rules (
  id                       uuid primary key default gen_random_uuid(),
  -- match
  consignee_entity_code    text not null,         -- 'COLEC'
  consignee_freshtrack_id  uuid not null,          -- consignee ROLE id
  crop_id                  uuid,                  -- NULL = all crops (default rule)
  crop_name                text,                  -- denormalised, humans only
  -- assign
  consignor_entity_code    text not null,         -- 'APPEC'
  consignor_freshtrack_id  uuid not null,          -- consignor ROLE id; revalidated live each run
  enabled                  boolean not null default true,
  notes                    text,
  created_by               uuid references public.hub_users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.consignor_assignment_rules is
  'Customer (+ optional crop) -> consignor mapping for the Auto FT Consignor '
  'Update process. No effective-date columns: the process only ever fills a '
  'BLANK consignor, so there is no history to protect from a rule change — '
  'see design doc §5 "what is gone".';

-- one active rule per (customer, crop) — crop NULL is the "any crop" default
create unique index consignor_rules_uniq
  on public.consignor_assignment_rules (
    consignee_entity_code,
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where enabled;

alter table public.consignor_assignment_rules enable row level security;
create policy consignor_assignment_rules_service_role_all on public.consignor_assignment_rules
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------- seed data
insert into public.process_definitions (key, name, description, enabled, mode, config)
values (
  'consignor_auto_assign',
  'Auto FT Consignor Update',
  'Fills a blank consignor on newly-arrived FreshTrack orders for known '
  'customers, per the mapping rules below. Never touches an order that '
  'already has a consignor set.',
  false,      -- disabled until an admin turns it on via the Tools UI
  'dry_run',  -- proposes only, even once enabled, until switched to apply
  '{
     "schedule": {"frequency": "every_n_hours", "n": 4},
     "assignable_state_codes": ["OR", "FORD", "Default"],
     "discovery_lookback_days": 3,
     "discovery_horizon_days": 45
   }'::jsonb
)
on conflict (key) do nothing;

-- Verified mapping — design doc §10. consignee/consignor role ids resolved
-- live against FreshTrack 2026-07-30 (Coles Melbourne -> MM Truganina is also
-- the pairing proven end-to-end on real order 5024318).
insert into public.consignor_assignment_rules
  (consignee_entity_code, consignee_freshtrack_id, crop_id, crop_name,
   consignor_entity_code, consignor_freshtrack_id, notes)
values
  ('COLTV', '01943e56-4e5e-393f-1199-493150e38b8d', null, null,
   'MMANN', '0193f60d-26da-5e09-15a2-e6906951def9', 'Coles Townsville'),
  ('COLBR', '01950289-2b36-8e1c-64cf-639cc2ce4819', null, null,
   'SQBRL', '019f58c7-7169-ee27-1316-eb720b8c000b', 'Coles Parkinson'),
  ('ALDIS', '01946363-081c-5790-6b28-9b7596bf667a', null, null,
   'SQBRL', '019f58c7-7169-ee27-1316-eb720b8c000b', 'ALDI Stapylton'),
  ('ALDIB', '01946362-8d1f-c354-b8ce-71839c6d8017', null, null,
   'SQBRL', '019f58c7-7169-ee27-1316-eb720b8c000b', 'ALDI Brendale'),
  ('COLME', '0191f93d-cd46-d93e-bcda-ecba5a6f7c20', null, null,
   'MMTRU', '0191f981-c9dc-4203-4f1b-3e9c5f5758d3',
   'Coles Melbourne — pairing verified live on order 5024318, 2026-07-30'),
  ('COLTA', '01943e55-a3bc-ba22-1f59-a6d0a2dfd5a1', null, null,
   'MMTRU', '0191f981-c9dc-4203-4f1b-3e9c5f5758d3', 'Coles Tasmania'),
  ('COLSA', '01950286-a53c-4844-f2da-195dfac46391', null, null,
   'MMTRU', '0191f981-c9dc-4203-4f1b-3e9c5f5758d3', 'Coles South Australia'),
  ('ALDIJ', '01946363-85eb-f3e9-cbaa-02fcf6f84739', null, null,
   'QPLCN', '01958d5a-630f-0513-49fe-80d5c928ee1d', 'ALDI Jandakot'),
  ('ALDID', '0194b555-8042-404e-39d3-22e067c07fa2', null, null,
   'MMEPP', '019dfa7e-11a5-b465-64c1-6e00d3e68d5c', 'ALDI Derrimut'),
  ('COLEC', '01943e52-06fd-8034-8499-60aaa2db52a3',
   '01931d7a-7265-3570-1ce3-998f9b370afb', 'Papaya',
   'APPEC', '019588ed-e54e-c954-1696-81581dae4e50',
   'Coles Eastern Creek, Papaya only. Passionfruit is deliberately NOT seeded '
   '— design doc §9.1 — those orders surface as "needs a decision" instead of '
   'being guessed at.')
on conflict do nothing;

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   select key, enabled, mode, config from process_definitions;
--   -- expect: consignor_auto_assign, enabled=false, mode=dry_run
--
--   select count(*) from consignor_assignment_rules where enabled;
--   -- expect: 10
--
--   select consignee_entity_code, crop_name, consignor_entity_code
--     from consignor_assignment_rules order by consignee_entity_code, crop_name;
--   -- expect 10 rows, COLEC appearing once (Papaya only)
-- =============================================================================
