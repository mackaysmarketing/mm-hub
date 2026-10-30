-- =============================================================================
-- Migration 00024 — Product-level consignor rules, "leave blank", and the
-- Woolworths marketer fill
-- =============================================================================
-- Asked for by Tim on 30 Oct 2026, after the Woolworths PO call with Gabby.
--
-- 1. PRODUCT-LEVEL RULES. Rules matched a customer and, optionally, a crop.
--    Woolworths needs to go one level down: ripe and green bananas are
--    different PRODUCTS of the same crop (910101 green 15kg, 910111 ripe
--    collars …) and go different ways. FreshTrack's own product "type" is only
--    Loose / Prepack, and its crop colour is filled on 18 of 300 products, so
--    neither can tell ripe from green — the product itself is the reliable
--    key. A rule now targets a crop OR one product (never both).
--
--    Precedence, per product on the order (lib/processes/consignorAssign/
--    matchOrder.ts): customer+product, any+product, customer+crop, any+crop,
--    customer default, global default.
--
-- 2. LEAVE BLANK. A rule's action is 'assign' (as before) or 'leave_blank':
--    "this tool must not set a consignor for this product". Green fruit's
--    consignor is the farm, set by hand when the farm load is linked to the
--    customer order. An order whose products are ALL leave-blank is skipped
--    quietly; one that mixes leave-blank and assigned products is raised as
--    "needs a decision" (no single header consignor would be true).
--
-- 3. MARKETER FILL. A second process, marketer_auto_fill ("Auto FT Marketer
--    Update"): Woolworths POs imported by hand from the web-forms XML arrive
--    with a blank marketer at some DCs (Minchinbury, Tasmania, Truganina), so
--    the Orders portal never sees them. The process fills a BLANK marketer
--    with Mackays Marketing on open orders whose customer sits under
--    Woolworths Head Office (WOWGL). It never changes a marketer that is set,
--    so third-party marketers (mangoes, service deliveries) are untouched.
--    Meant to be switched off once Woolworths EDI sends the marketer itself.
--
-- SAFE TO APPLY BEFORE THE CODE DEPLOYS. Every new column is nullable or has
-- a default that matches today's behaviour ('assign'); every existing rule
-- satisfies every new constraint; the new process is seeded DISABLED and in
-- DRY RUN, so nothing new runs or writes until an admin turns it on.
-- =============================================================================

begin;

-- ------------------------------------------------- 1 + 2: rule table changes
alter table public.consignor_assignment_rules
  add column product_id   uuid,  -- FreshTrack product id; NULL = not product-specific
  add column product_code text,  -- denormalised, humans only (e.g. '910111')
  add column product_name text,  -- denormalised, humans only
  add column action       text not null default 'assign'
                          check (action in ('assign', 'leave_blank'));

comment on column public.consignor_assignment_rules.product_id is
  'Migration 00024. Set = this rule applies to one FreshTrack product, more '
  'specific than a crop rule. Never set together with crop_id.';
comment on column public.consignor_assignment_rules.action is
  'assign = set consignor_* on a blank order (as before 00024). leave_blank = '
  'never set a consignor for this product (e.g. green fruit, whose consignor '
  'is the farm and is set when the farm load is linked).';

-- A leave_blank rule has no consignor, so these become nullable — and the
-- check below makes an assign rule still require one.
alter table public.consignor_assignment_rules
  alter column consignor_entity_code drop not null,
  alter column consignor_freshtrack_id drop not null;

alter table public.consignor_assignment_rules
  add constraint consignor_rules_action_consignor check (
    (action = 'assign'
       and consignor_entity_code is not null
       and consignor_freshtrack_id is not null)
    or (action = 'leave_blank'
       and consignor_entity_code is null
       and consignor_freshtrack_id is null)
  );

-- A rule targets a crop OR a product.
alter table public.consignor_assignment_rules
  add constraint consignor_rules_crop_or_product
  check (crop_id is null or product_id is null);

-- Still never fully wildcard — now any one of customer, crop or product will do.
alter table public.consignor_assignment_rules
  drop constraint consignor_rules_not_fully_wildcard;
alter table public.consignor_assignment_rules
  add constraint consignor_rules_not_fully_wildcard
  check (consignee_entity_code is not null or crop_id is not null or product_id is not null);

-- One active rule per (customer, crop, product).
drop index if exists public.consignor_rules_uniq;
create unique index consignor_rules_uniq
  on public.consignor_assignment_rules (
    coalesce(consignee_entity_code, '*'),
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where enabled;

-- ------------------------------------------------------- 3: marketer fill
-- Role ids are resolved LIVE each run from the codes below (MACKM's marketer
-- role is 0192035b-0cf8-4e5f-8675-e6144ff7df99 and WOWGL has nine DCs as of
-- 30 Oct 2026), so a renumbered or new DC needs no config change.
insert into public.process_definitions (key, name, description, enabled, mode, config)
values (
  'marketer_auto_fill',
  'Auto FT Marketer Update',
  'Fills a blank marketer on open Woolworths orders with Mackays Marketing. '
  'Never changes a marketer that is already set.',
  false,      -- off until an admin turns it on in the Marketer fill tab
  'dry_run',  -- proposes only, even once on, until switched to apply
  '{
     "schedule": {"frequency": "every_n_minutes", "n": 5},
     "assignable_state_codes": ["OR", "FORD", "Default"],
     "customer_group_codes": ["WOWGL"],
     "marketer_entity_code": "MACKM",
     "discovery_lookback_days": 120,
     "discovery_horizon_days": 60
   }'::jsonb
)
on conflict (key) do nothing;

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   -- every existing rule is now an 'assign' rule with no product
--   select action, count(*), count(product_id) from consignor_assignment_rules group by 1;
--   -- expect: assign | 12 | 0   (the 12 live rules on 30 Oct 2026)
--
--   select key, enabled, mode, config->>'customer_group_codes'
--   from process_definitions where key = 'marketer_auto_fill';
--   -- expect: marketer_auto_fill | false | dry_run | ["WOWGL"]
--
--   -- expect each of these to FAIL with a check violation
--   -- insert into consignor_assignment_rules (consignee_entity_code, consignee_freshtrack_id, action)
--   --   values ('X', gen_random_uuid(), 'assign');                       -- assign, no consignor
--   -- insert into consignor_assignment_rules (consignee_entity_code, consignee_freshtrack_id, action,
--   --   consignor_entity_code, consignor_freshtrack_id)
--   --   values ('X', gen_random_uuid(), 'leave_blank', 'Y', gen_random_uuid()); -- blank with a consignor
--
-- TO UNDO: disable any product or leave_blank rules in the Tools page, switch
-- the marketer fill off, then
--   delete from consignor_assignment_rules where product_id is not null or action = 'leave_blank';
--   drop index consignor_rules_uniq;  -- and re-create it as in 00018
--   alter table consignor_assignment_rules drop constraint consignor_rules_crop_or_product,
--     drop constraint consignor_rules_action_consignor, drop constraint consignor_rules_not_fully_wildcard;
--   alter table consignor_assignment_rules add constraint consignor_rules_not_fully_wildcard
--     check (consignee_entity_code is not null or crop_id is not null);
--   alter table consignor_assignment_rules alter column consignor_entity_code set not null,
--     alter column consignor_freshtrack_id set not null;
--   alter table consignor_assignment_rules drop column action, drop column product_name,
--     drop column product_code, drop column product_id;
--   delete from process_actions where process_key = 'marketer_auto_fill';
--   delete from process_runs where process_key = 'marketer_auto_fill';
--   delete from process_definitions where key = 'marketer_auto_fill';
-- =============================================================================
