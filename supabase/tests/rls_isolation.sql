-- =============================================================================
-- RLS Isolation Suite — proves grower_group tenant isolation + two-axis scoping
-- =============================================================================
-- Run against a throwaway DB that has migration 00005 applied. Seeds two groups
-- and impersonates each persona via the authenticated role + a JWT `sub` claim
-- (auth.uid() reads request.jwt.claims->>'sub'; no auth.users row required).
--
-- Scenario:
--   Group A: recipient RA; farms A1, A2 (both paid by RA); remittance remA(RA).
--   Group B: recipient RB; farm B1 (paid by RB);            remittance remB(RB).
--   Fact rows (ft_consignments / qa / documents / line items) hang off each farm.
--
-- Personas (module_access on 'grower-portal'):
--   U_growerA1  grower       group A, grower_ids=[A1], recipient_ids=null
--   U_adminA    grower_admin group A, all farms + recipients
--   U_growerB1  grower       group B, grower_ids=[B1]
--   U_staff     staff        internal (cross-tenant)
--   U_hubadmin  hub_admin    cross-tenant via is_hub_admin()
--
-- Expected visible-row matrix (the green-bar definition of done):
--   persona      groups farms recipients remits consign qa docs lines
--   U_growerA1     1      1       1         1       1     1   1    1
--   U_adminA       1      2       1         1       2     1   1    1
--   U_growerB1     1      1       1         1       1     1   1    1
--   U_staff        2      3       2         2       3     2   2    2
--   U_hubadmin     2      3       2         2       3     2   2    2
--   ^ A-personas NEVER see B's rows and vice-versa (cross-group isolation).
-- =============================================================================

-- ---- SEED (run as service_role / postgres) ---------------------------------
-- Branch-only: relax synthetic-user FKs so we don't need real auth.users rows.
alter table public.module_access drop constraint if exists module_access_user_id_fkey;
alter table public.module_access drop constraint if exists module_access_granted_by_fkey;
alter table public.hub_users    drop constraint if exists hub_users_id_fkey;

insert into public.grower_groups (id, name) values
  ('00000000-0000-0000-0000-0000000000aa', 'Group A'),
  ('00000000-0000-0000-0000-0000000000bb', 'Group B');

insert into public.rcti_recipients (id, grower_group_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'Recipient A'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'Recipient B');

insert into public.growers (id, name, code, freshtrack_code, grower_group_id, rcti_recipient_id) values
  ('00000000-0000-0000-0000-0000000a0001', 'Farm A1', 'A1', 'FTA1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000a0002', 'Farm A2', 'A2', 'FTA2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000b0001', 'Farm B1', 'B1', 'FTB1', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000b1');

insert into public.remittances (id, grower_id, recipient_id, rcti_ref, total_gross) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000a1', 'RCTI-A', 1000),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000000b1', 'RCTI-B', 2000);

insert into public.remittance_line_items (id, remittance_id, farm_id, product, total_amount) values
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000a0001', 'Bananas', 500),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000b0001', 'Bananas', 900);

insert into public.ft_consignments (id, grower_id, product_name) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0001', 'Cavendish'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0002', 'Cavendish'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0001', 'Lady Finger');

insert into public.qa_assessments (id, grower_id, assessment_date, status) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0001', current_date, 'compliant'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0001', current_date, 'compliant');

insert into public.documents (id, grower_id, name, category, storage_path) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0001', 'Doc A', 'general', 'a/doc.pdf'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0001', 'Doc B', 'general', 'b/doc.pdf');

insert into public.hub_users (id, name, email, auth_provider, hub_role, active) values
  ('dddd0001-0000-0000-0000-000000000001', 'Hub Admin', 'hub@example.com', 'email', 'hub_admin', true);

insert into public.module_access (id, user_id, module_id, module_role, config, active) values
  (gen_random_uuid(), 'aaaa0001-0000-0000-0000-000000000001', 'grower-portal', 'grower',
     '{"grower_group_id":"00000000-0000-0000-0000-0000000000aa","grower_ids":["00000000-0000-0000-0000-0000000a0001"],"recipient_ids":null}', true),
  (gen_random_uuid(), 'aaaa0001-0000-0000-0000-000000000002', 'grower-portal', 'grower_admin',
     '{"grower_group_id":"00000000-0000-0000-0000-0000000000aa","grower_ids":null,"recipient_ids":null}', true),
  (gen_random_uuid(), 'bbbb0001-0000-0000-0000-000000000001', 'grower-portal', 'grower',
     '{"grower_group_id":"00000000-0000-0000-0000-0000000000bb","grower_ids":["00000000-0000-0000-0000-0000000b0001"],"recipient_ids":null}', true),
  (gen_random_uuid(), 'cccc0001-0000-0000-0000-000000000001', 'grower-portal', 'staff', '{}', true);

-- ---- ASSERT (run once per persona) -----------------------------------------
-- Template — substitute <SUB> with each persona's user_id:
--   set local role authenticated;
--   set local request.jwt.claims to '{"sub":"<SUB>","role":"authenticated"}';
--   select
--     (select count(*) from grower_groups)        as groups,
--     (select count(*) from growers)              as farms,
--     (select count(*) from rcti_recipients)      as recipients,
--     (select count(*) from remittances)          as remits,
--     (select count(*) from ft_consignments)      as consignments,
--     (select count(*) from qa_assessments)       as qa,
--     (select count(*) from documents)            as docs,
--     (select count(*) from remittance_line_items) as lines;
