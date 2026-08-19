-- =============================================================================
-- Migration 00023 — Retailer Price Verification tool (Coles + Woolworths)
-- =============================================================================
-- Verifies FreshTrack order line prices against the weekly quote extracts
-- downloaded from the Coles and Woolworths supplier portals.
--
-- WHERE THE ORDER DATA COMES FROM (read before editing)
--   NOT live GraphQL. The nightly FreshTrack sync (migrations 00010/00016,
--   lib/freshtrack/sync/orderSync.ts + orderItemSync.ts) already lands every
--   field this tool needs into Postgres:
--       ft_orders.scheduled_delivery_on   — the delivery-window filter
--       ft_orders.consignee_ft_id         — the consignee association id, i.e.
--                                           the "consigneeId trap" already
--                                           resolved by entitySync
--       ft_orders.latest_order_version_ft_id — the versioning trap already
--                                           resolved; items are only ever
--                                           synced for the latest version
--       ft_orders.state_name              — order state, for the state filter
--       ft_order_items.item_no            — the retailer article/product code,
--                                           i.e. the join key to the quote
--       ft_order_items.price_value/price_per — the price under test (per BOX)
--   Reading Postgres instead of fanning out over GraphQL removes the rate-limit
--   and checkpoint-resume problem entirely rather than mitigating it: a whole
--   week of orders is one query, not ~2N calls that hang the FT server.
--
--   The cost is coverage: the sync only holds what it has swept. A window
--   outside local coverage must NOT be silently reported as "no orders" — the
--   run records its coverage check and refuses rather than under-report. For
--   historical windows predating the sync, scripts/price-verification-backtest
--   walks live GraphQL with pacing and checkpointing.
--
-- SAFE BY DEFAULT
--   This tool NEVER writes to FreshTrack. There is no "Price Verified" order
--   state in FreshTrack yet (sprint decision D3 is unresolved), so verification
--   produces a report and nothing else. write_back_state_ft_id is reserved
--   below and is deliberately unused until that state exists and D3 is decided.
-- =============================================================================

begin;

-- ---------------------------------------------------------------- tool access
-- Generic per-tool grant. The Tools section currently shows every tool to every
-- internal user; this table narrows an individual tool to named people without
-- having to mint a new module role for each one. hub_admin always has access
-- and never needs a row.
create table public.tool_access (
  id          uuid primary key default gen_random_uuid(),
  tool_key    text not null,
  user_id     uuid not null references public.hub_users(id) on delete cascade,
  granted_by  uuid references public.hub_users(id),
  created_at  timestamptz not null default now(),
  unique (tool_key, user_id)
);

comment on table public.tool_access is
  'Per-tool access grants for individual Hub tools. A user sees a gated tool if '
  'they are hub_admin, or hold a row here for that tool_key. Tools with no '
  'entry in lib/tools/registry.ts gated list stay open to all internal users.';

create index on public.tool_access (user_id);

-- --------------------------------------------------- retailer DC → consignee
-- The quote extracts identify a destination by the retailer's own DC code
-- (Coles 'BRI9415', Woolworths '2986'). FreshTrack identifies it by entity.
-- Mapping lives here, not in code, so an unmapped DC is an admin fix rather
-- than a deploy. entity_code null = deliberately unmapped; its orders are
-- reported as unmapped rather than silently dropped.
create table public.retailer_dc_map (
  id           uuid primary key default gen_random_uuid(),
  retailer     text not null check (retailer in ('coles','woolworths')),
  dc_code      text not null,
  dc_label     text,
  entity_code  text,
  active       boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (retailer, dc_code)
);

comment on column public.retailer_dc_map.entity_code is
  'ft_entities.entity_code for the consignee. NULL = known DC with no confirmed '
  'FreshTrack entity; its orders are reported as "DC not mapped", never dropped.';

-- ------------------------------------------------------------ uploaded quotes
create table public.price_quote_files (
  id             uuid primary key default gen_random_uuid(),
  retailer       text not null check (retailer in ('coles','woolworths')),
  file_name      text not null,
  file_hash      text not null,
  period_start   date not null,
  period_end     date not null,
  line_count     int  not null default 0,
  row_count      int  not null default 0,
  parse_warnings jsonb not null default '[]'::jsonb,
  uploaded_by    uuid references public.hub_users(id),
  created_at     timestamptz not null default now()
);

comment on column public.price_quote_files.file_hash is
  'sha256 of the uploaded bytes. Re-uploading the same file replaces the prior '
  'parse rather than creating a second competing quote for the same week.';

create unique index price_quote_files_hash_key on public.price_quote_files (file_hash);
create index on public.price_quote_files (retailer, period_start desc);

-- One row per article × DC × DAY. Woolworths quotes carry a separate price per
-- weekday; Coles carries a start/end range. Expanding both to a per-day grain
-- makes the lookup a single exact key — (dc_code, article_no, delivery date) —
-- and means a mid-week Woolworths price change is honoured rather than
-- flattened to one week price.
create table public.price_quote_lines (
  id             uuid primary key default gen_random_uuid(),
  quote_file_id  uuid not null references public.price_quote_files(id) on delete cascade,
  retailer       text not null,
  dc_code        text not null,
  article_no     text not null,
  description    text,
  effective_on   date not null,
  price          numeric(14,4),
  approved       boolean not null default true,
  order_multiple int,
  unique (quote_file_id, dc_code, article_no, effective_on)
);

comment on column public.price_quote_lines.price is
  'NULL = the quote row carried no price. Never a mismatch — an order line '
  'against it is reported "quote has no price", because there is nothing to '
  'compare against.';

comment on column public.price_quote_lines.approved is
  'Coles "Approved? = Checked" / Woolworths "Status = Approved AND Latest '
  'Version = Current". Whether an unapproved-but-priced row is usable is a '
  'run setting (unapproved_quotes), not a hardcoded rule.';

-- The unique constraint above already indexes exactly the lookup key
-- (quote_file_id, dc_code, article_no, effective_on), so no second index here.

-- ------------------------------------------------------------------- runs
create table public.price_verification_runs (
  id                uuid primary key default gen_random_uuid(),
  quote_file_id     uuid not null references public.price_quote_files(id) on delete cascade,
  status            text not null check (status in ('running','success','failed')),
  triggered_by      uuid references public.hub_users(id),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  settings          jsonb not null default '{}'::jsonb,
  coverage          jsonb not null default '{}'::jsonb,
  -- The six outcome buckets PARTITION orders_total exactly — every order in the
  -- window lands in exactly one, so the report's totals reconcile by
  -- construction. orders_duplicate is a cross-cutting flag, not a bucket, and
  -- is therefore counted separately and NOT added to the total.
  orders_total      int not null default 0,
  orders_verified   int not null default 0,
  orders_mismatched int not null default 0,
  orders_partial    int not null default 0,
  orders_no_quote   int not null default 0,
  orders_skipped    int not null default 0,
  orders_unmapped   int not null default 0,
  orders_duplicate  int not null default 0,
  lines_total       int not null default 0,
  lines_matched     int not null default 0,
  lines_mismatched  int not null default 0,
  lines_no_quote    int not null default 0,
  error             text,
  constraint price_verification_runs_totals_reconcile check (
    status <> 'success' or
    orders_total = orders_verified + orders_mismatched + orders_partial
                 + orders_no_quote + orders_skipped + orders_unmapped
  )
);

comment on column public.price_verification_runs.coverage is
  'The local-sync coverage check for the quote period: {covered, ordersInWindow, '
  'syncedThrough, warning}. Recorded so a thin report can be told apart from a '
  'genuinely empty week after the fact.';

comment on column public.price_verification_runs.settings is
  'Frozen copy of the settings the run used: {tolerance, verifiableStates, '
  'skipStates, unapprovedQuotes}. A later settings change must not silently '
  'rewrite what an old report meant.';

create index on public.price_verification_runs (quote_file_id, started_at desc);

-- --------------------------------------------------------- per-order rollup
create table public.price_verification_orders (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.price_verification_runs(id) on delete cascade,
  order_ft_id      uuid,
  order_no         text,
  order_state      text,
  consignee_code   text,
  consignee_name   text,
  dc_code          text,
  delivery_date    date,
  outcome          text not null check (outcome in
                     ('verified','mismatch','no_quote','partial','skipped','unmapped')),
  reason           text,
  duplicate_group  text,
  is_duplicate     boolean not null default false,
  lines_total      int not null default 0,
  lines_matched    int not null default 0,
  lines_mismatched int not null default 0,
  lines_no_quote   int not null default 0
);

comment on column public.price_verification_orders.outcome is
  'verified = every line matched. mismatch = at least one line differed. '
  'partial = no mismatches but at least one line had no usable quote. '
  'no_quote = no line had a usable quote. skipped = state excluded (e.g. '
  'Cancelled). unmapped = the DC has no FreshTrack entity mapping.';

comment on column public.price_verification_orders.duplicate_group is
  'Orders sharing consignee + delivery date + identical line signature. Coles '
  'Melbourne runs parallel Ordered/Invoiced series that look like EDI '
  're-imports; all members are reported, the later ones flagged is_duplicate '
  'so totals do not double-count.';

create index on public.price_verification_orders (run_id, outcome);

-- ---------------------------------------------------------- per-line detail
create table public.price_verification_lines (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.price_verification_runs(id) on delete cascade,
  order_row_id      uuid not null references public.price_verification_orders(id) on delete cascade,
  line_no           int,
  item_no           text,
  description       text,
  quantity          int,
  order_price       numeric(14,4),
  price_per         text,
  quote_price       numeric(14,4),
  variance          numeric(14,4),
  outcome           text not null check (outcome in
                      ('match','mismatch','no_quote','quote_unpriced','quote_unapproved','no_order_price')),
  detail            text
);

create index on public.price_verification_lines (run_id, outcome);
create index on public.price_verification_lines (order_row_id);

-- --------------------------------------------------------------- settings
-- Singleton. Defaults are the sprint's proposals; every one is admin-editable
-- so a policy change is a UI toggle rather than a migration.
create table public.price_verification_settings (
  id                    int primary key default 1 check (id = 1),
  tolerance             numeric(10,4) not null default 0,
  verifiable_states     text[] not null default
                          array['Ordered','Filled','Shipped','Ready to Invoice','Invoiced'],
  skip_states           text[] not null default array['Cancelled'],
  unapproved_quotes     text not null default 'use'
                          check (unapproved_quotes in ('use','skip')),
  write_back_enabled    boolean not null default false,
  write_back_state_ft_id uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.hub_users(id)
);

comment on column public.price_verification_settings.tolerance is
  'Absolute dollars. 0 = exact match only (sprint D1 default; the Parkinson '
  'test data matched exactly).';

comment on column public.price_verification_settings.unapproved_quotes is
  'How to treat a quote row that carries a price but is not approved '
  '("Unchecked" at Coles). use = compare against it anyway and note it; '
  'skip = treat as no usable quote. Default "use": in the 7-13 Apr Coles '
  'sample only 5 of 13 Parkinson rows are Checked, yet the papaya and '
  'passionfruit lines carry real prices the orders were placed against.';

comment on column public.price_verification_settings.write_back_state_ft_id is
  'RESERVED. Writing a "Price Verified" state back to FreshTrack is not '
  'implemented — that state does not exist in FreshTrack yet (sprint D3). '
  'Nothing reads this column.';

insert into public.price_verification_settings (id) values (1);

-- ----------------------------------------------------------------- seed map
-- Verified against ft_entities on 2026-08-19. Two DCs are deliberately left
-- unmapped rather than guessed — see notes.
insert into public.retailer_dc_map (retailer, dc_code, dc_label, entity_code, notes) values
  ('coles','BRI9415','Coles Parkinson',        'COLBR', null),
  ('coles','TSV9424','Coles Townsville',       'COLTV', null),
  ('coles','MEB9314','Coles Melbourne',        'COLME', null),
  ('coles','SNY9247','Coles Eastern Creek',    'COLEC', null),
  ('coles','ADE9541','Coles South Australia',  'COLSA',
     'Sprint listed Coles Adelaide COLAD as the alternative; no such entity exists in ft_entities and COLSA is the active one.'),
  ('coles','DPO9745',null,                      null,
     'UNRESOLVED (sprint D5). No confirmed FreshTrack entity. Orders for this DC are reported as "DC not mapped".'),
  ('woolworths','2986','Brisbane RDC - Produce',        'WOWBR', null),
  ('woolworths','2996','Townsville RDC - Produce',      'WOWTO', null),
  ('woolworths','3953','Melbourne Fresh DC - Produce',  'WOWTR', null),
  ('woolworths','7986','Tasmania RDC - Produce',        'WOWTA', null),
  ('woolworths','1986','Sydney RDC - Produce',          'WOWMI',
     'Sprint D6: Sydney RDC 1986 assumed = Woolworths Minchinbury. Not yet confirmed with the WOW team.');

-- Avocado-variant consignees. Woolworths books avocado volume against separate
-- consignee entities, so an avocado line on a WOW quote can legitimately land
-- on either. Both are accepted for the same DC code.
create table public.retailer_dc_alt_entities (
  id           uuid primary key default gen_random_uuid(),
  dc_map_id    uuid not null references public.retailer_dc_map(id) on delete cascade,
  entity_code  text not null,
  note         text,
  unique (dc_map_id, entity_code)
);

comment on table public.retailer_dc_alt_entities is
  'Additional consignee entities that belong to the same retailer DC — the '
  'Woolworths "- Avocados" variants (WWBRA, WWTOA, WWMIA, WWTRA, WWWYA). An '
  'order against one of these is verified against the parent DC''s quote rows.';

insert into public.retailer_dc_alt_entities (dc_map_id, entity_code, note)
select m.id, v.entity_code, 'Woolworths avocado consignee variant'
from public.retailer_dc_map m
join (values
  ('2986','WWBRA'),
  ('2996','WWTOA'),
  ('1986','WWMIA'),
  ('3953','WWTRA')
) as v(dc_code, entity_code) on v.dc_code = m.dc_code
where m.retailer = 'woolworths';

-- --------------------------------------------------------------------- RLS
-- service_role bypasses RLS; every route in this tool goes through the admin
-- client after checking tool access in app code. The policies below exist so
-- the rls_enabled_no_policy advisor stays quiet and so a stray anon/authenticated
-- key cannot read commercially sensitive retailer pricing.
alter table public.tool_access                    enable row level security;
alter table public.retailer_dc_map                enable row level security;
alter table public.retailer_dc_alt_entities       enable row level security;
alter table public.price_quote_files              enable row level security;
alter table public.price_quote_lines              enable row level security;
alter table public.price_verification_runs        enable row level security;
alter table public.price_verification_orders      enable row level security;
alter table public.price_verification_lines       enable row level security;
alter table public.price_verification_settings    enable row level security;

create policy tool_access_service_role_all on public.tool_access
  for all to service_role using (true) with check (true);
create policy retailer_dc_map_service_role_all on public.retailer_dc_map
  for all to service_role using (true) with check (true);
create policy retailer_dc_alt_service_role_all on public.retailer_dc_alt_entities
  for all to service_role using (true) with check (true);
create policy price_quote_files_service_role_all on public.price_quote_files
  for all to service_role using (true) with check (true);
create policy price_quote_lines_service_role_all on public.price_quote_lines
  for all to service_role using (true) with check (true);
create policy price_verification_runs_service_role_all on public.price_verification_runs
  for all to service_role using (true) with check (true);
create policy price_verification_orders_service_role_all on public.price_verification_orders
  for all to service_role using (true) with check (true);
create policy price_verification_lines_service_role_all on public.price_verification_lines
  for all to service_role using (true) with check (true);
create policy price_verification_settings_service_role_all on public.price_verification_settings
  for all to service_role using (true) with check (true);

-- A user may read their OWN tool grants (the sidebar/tools index asks "can I
-- see this tool"). No table here grants anything to anon.
create policy tool_access_read_own on public.tool_access
  for select to authenticated using (user_id = auth.uid());

revoke all on public.tool_access                 from anon;
revoke all on public.retailer_dc_map             from anon;
revoke all on public.retailer_dc_alt_entities    from anon;
revoke all on public.price_quote_files           from anon;
revoke all on public.price_quote_lines           from anon;
revoke all on public.price_verification_runs     from anon;
revoke all on public.price_verification_orders   from anon;
revoke all on public.price_verification_lines    from anon;
revoke all on public.price_verification_settings from anon;

grant select on public.tool_access to authenticated;
grant all on public.tool_access                 to service_role;
grant all on public.retailer_dc_map             to service_role;
grant all on public.retailer_dc_alt_entities    to service_role;
grant all on public.price_quote_files           to service_role;
grant all on public.price_quote_lines           to service_role;
grant all on public.price_verification_runs     to service_role;
grant all on public.price_verification_orders   to service_role;
grant all on public.price_verification_lines    to service_role;
grant all on public.price_verification_settings to service_role;

commit;
