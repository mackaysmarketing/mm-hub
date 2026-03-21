-- =============================================================
-- MM-Hub Seed Data
-- =============================================================

-- Test growers
INSERT INTO public.growers (id, name, code, freshtrack_code, abn, email, active) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'North Queensland Banana Co', 'NQBC', 'NQBC001', '12345678901', 'admin@nqbc.com.au', true),
  ('a1000000-0000-0000-0000-000000000002', 'Tully River Farms', 'TRF', 'TRF001', '98765432109', 'info@tullyriverfarms.com.au', true),
  ('a1000000-0000-0000-0000-000000000003', 'Lakeland Pastoral', 'LP', 'LP001', '11223344556', 'office@lakelandpastoral.com.au', true);

-- hub_users and module_access are created via auth trigger + admin UI.
-- For local development, after creating auth users via Supabase dashboard:
--
-- 1. Make yourself a hub_admin:
--    UPDATE public.hub_users SET hub_role = 'hub_admin' WHERE email = 'your@email.com';
--
-- 2. Grant yourself grower-portal module admin:
--    INSERT INTO public.module_access (user_id, module_id, module_role, config)
--    SELECT id, 'grower-portal', 'admin', '{"grower_id":null,"allowed_menu_items":["Dashboard","Sales & Pricing","QA & Compliance","Forecasting","Remittances","Documents"],"capabilities":["manage_users","view_all_growers","enter_qa","trigger_sync"]}'::jsonb
--    FROM public.hub_users WHERE email = 'your@email.com';
--
-- 3. Create a test grower user (after creating via Supabase Auth email/password):
--    INSERT INTO public.module_access (user_id, module_id, module_role, config)
--    SELECT id, 'grower-portal', 'grower', '{"grower_id":"a1000000-0000-0000-0000-000000000001","allowed_menu_items":["Dashboard","Sales & Pricing","Remittances","Documents"],"capabilities":[]}'::jsonb
--    FROM public.hub_users WHERE email = 'grower@test.com';

-- Sample farms
INSERT INTO public.farms (id, grower_id, name, code, region, active) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Tully River Block A', 'TRB-A', 'Tully', true),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Tully River Block B', 'TRB-B', 'Tully', true),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Lakeland Station', 'LKS', 'Lakeland', true),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'Mission Beach Farm', 'MBF', 'Mission Beach', true),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'El Arish Property', 'EAP', 'El Arish', true);

-- Sample ft_consignments
INSERT INTO public.ft_consignments (ft_id, grower_id, entity_code, consignment_date, sale_date, customer_name, product_name, produce_category, quantity, weight_kg, unit_price, total_amount, status) VALUES
  (1001, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-10', '2026-03-10', 'Coles', 'Bananas 13.5kg', 'Banana', 80, 1080.00, 22.50, 1800.00, 'Completed'),
  (1002, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-10', '2026-03-10', 'Woolworths', 'Bananas 13.5kg', 'Banana', 120, 1620.00, 23.00, 2760.00, 'Completed'),
  (1003, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-11', '2026-03-11', 'ALDI', 'Bananas 13.5kg', 'Banana', 60, 810.00, 21.00, 1260.00, 'Completed'),
  (1004, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-12', '2026-03-12', 'Coles', 'Avocados 6kg', 'Avocado', 40, 240.00, 36.00, 1440.00, 'Completed'),
  (1005, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-03', '2026-03-03', 'Woolworths', 'Bananas 13.5kg', 'Banana', 100, 1350.00, 22.00, 2200.00, 'Completed'),
  (1006, 'a1000000-0000-0000-0000-000000000001', 'NQBC001', '2026-03-03', '2026-03-03', 'Coles', 'Papaya 4kg', 'Papaya', 30, 120.00, 28.00, 840.00, 'Completed'),
  (1007, 'a1000000-0000-0000-0000-000000000002', 'TRF001', '2026-03-10', '2026-03-10', 'Woolworths', 'Bananas 13.5kg', 'Banana', 200, 2700.00, 22.80, 4560.00, 'Completed'),
  (1008, 'a1000000-0000-0000-0000-000000000002', 'TRF001', '2026-03-11', '2026-03-11', 'ALDI', 'Bananas 13.5kg', 'Banana', 150, 2025.00, 20.50, 3075.00, 'Completed');

-- Sample remittance
INSERT INTO public.remittances (id, grower_id, netsuite_id, rcti_ref, payment_date, grower_name, total_gross, total_deductions, total_invoiced, total_quantity, status) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'NS-10001', 'RCTI-2026-0042', '2026-03-07', 'North Queensland Banana Co', 8500.00, 1275.00, 7225.00, 340, 'processed');

INSERT INTO public.remittance_line_items (remittance_id, sale_date, product, quantity, unit_price, total_amount, customer, produce_category) VALUES
  ('b1000000-0000-0000-0000-000000000001', '2026-03-03', 'Bananas 13.5kg', 180, 22.50, 4050.00, 'Coles', 'Banana'),
  ('b1000000-0000-0000-0000-000000000001', '2026-03-04', 'Bananas 13.5kg', 160, 23.00, 3680.00, 'Woolworths', 'Banana');

INSERT INTO public.remittance_charges (remittance_id, charge_type, ex_gst, gst, total_amount) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Commission', 850.00, 85.00, 935.00),
  ('b1000000-0000-0000-0000-000000000001', 'Freight', 300.00, 30.00, 330.00);
