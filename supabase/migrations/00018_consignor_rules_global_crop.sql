-- =============================================================================
-- Migration 00018 — Global (any-customer) crop rules for Auto FT Consignor Update
-- =============================================================================
-- Confirmed with Tim 2026-07-30: ALL passionfruit, regardless of customer,
-- routes via SQBR. The rule model built in 00017 only supported (customer,
-- optional crop) -> consignor, with no way to say "this crop, any customer".
--
-- This makes consignee_entity_code / consignee_freshtrack_id NULLABLE, so
-- crop_id IS NULL already means "any crop" (00017) and consignee IS NULL now
-- means "any customer" — the same wildcard pattern applied to the other axis.
--
-- MATCH PRECEDENCE (see lib/processes/consignorAssign/matchOrder.ts):
--   1. (customer, crop)   — most specific, e.g. COLEC + Papaya -> APPEC
--   2. (any,      crop)   — global crop rule, e.g. any + Passionfruit -> SQBR
--   3. (customer, any)    — customer default, e.g. COLME + any -> MMTRU
--   4. (any,      any)    — global default; structurally permitted, not used today
--
-- This also RESOLVES a previously-open question (design doc §9.1): Coles
-- Eastern Creek's Passionfruit was deliberately left unmapped because the
-- correct consignor wasn't known. It is now covered by the global rule below
-- — no COLEC-specific Passionfruit row is needed or added.
--
-- DISCOVERY-SCOPE LIMITATION (important, not fixed by this migration): the
-- process discovers candidate orders via filterConsigneeIds scoped to
-- customers that have a NON-null-consignee rule (lib/processes/
-- consignorAssign/index.ts). A global rule does NOT add any new consignee to
-- that discovery scope — it only changes the OUTCOME for crops present on
-- orders belonging to customers who are ALREADY being discovered via some
-- other rule. A customer with literally no rule of their own still won't be
-- found, even though the global rule would apply to them once discovered.
-- Today this is a non-issue (10 customer rules already drive discovery), but
-- if every customer-specific rule were ever removed, the global rule alone
-- would discover nothing.
-- =============================================================================

begin;

alter table public.consignor_assignment_rules
  alter column consignee_entity_code drop not null,
  alter column consignee_freshtrack_id drop not null;

-- A rule with BOTH consignee and crop null would match literally everything
-- with no more specific rule — a footgun with no current use case. Block it
-- structurally rather than relying on UI discipline.
alter table public.consignor_assignment_rules
  add constraint consignor_rules_not_fully_wildcard
  check (consignee_entity_code is not null or crop_id is not null);

-- Replace the (customer, crop) unique index with one that also accommodates
-- a null customer, using the same coalesce-to-sentinel trick 00017 used for
-- crop_id.
drop index if exists public.consignor_rules_uniq;
create unique index consignor_rules_uniq
  on public.consignor_assignment_rules (
    coalesce(consignee_entity_code, '*'),
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where enabled;

comment on column public.consignor_assignment_rules.consignee_entity_code is
  'NULL = any customer (global crop rule). Never NULL together with crop_id — '
  'see consignor_rules_not_fully_wildcard.';

-- ----------------------------------------------------------------- seed data
-- Global: all Passionfruit, any customer, routes via SQBR - Location.
-- Also closes the previously-open COLEC Passionfruit question (design doc
-- §9.1) — COLEC gets no crop-specific override, so this rule now covers it.
insert into public.consignor_assignment_rules
  (consignee_entity_code, consignee_freshtrack_id, crop_id, crop_name,
   consignor_entity_code, consignor_freshtrack_id, notes)
values
  (null, null,
   '01931d81-d565-66bf-6784-3930017e80a2', 'Passionfruit',
   'SQBRL', '019f58c7-7169-ee27-1316-eb720b8c000b',
   'Global rule: ALL passionfruit routes via SQBR regardless of customer '
   '(confirmed with Tim 2026-07-30). Also resolves the previously-unmapped '
   'Coles Eastern Creek Passionfruit gap.')
on conflict do nothing;

commit;

-- =============================================================================
-- Verification (service_role / postgres, after apply):
--
--   -- expect 11 active rules now (10 from 00017 + 1 global passionfruit)
--   select count(*) filter (where enabled) from consignor_assignment_rules;
--
--   -- expect one row with null consignee
--   select consignee_entity_code, crop_name, consignor_entity_code
--     from consignor_assignment_rules where consignee_entity_code is null;
--
--   -- expect this to FAIL with a check violation (fully wildcard rejected)
--   -- insert into consignor_assignment_rules
--   --   (consignee_entity_code, consignee_freshtrack_id, consignor_entity_code, consignor_freshtrack_id)
--   --   values (null, null, 'X', gen_random_uuid());
-- =============================================================================
