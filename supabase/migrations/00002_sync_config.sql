-- =============================================================
-- MM-Hub Migration 00002 — Sync Config Table
-- Stores field mapping configuration for each sync step.
-- Mappings are admin-configurable via UI — no code deploy needed
-- when FreshTrack column names change.
-- =============================================================

-- 1. Create sync_config table

CREATE TABLE public.sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_source text NOT NULL CHECK (sync_source IN ('freshtrack', 'netsuite')),
  step_order integer NOT NULL,              -- execution order (1-8 for FreshTrack)
  source_view text NOT NULL,                -- e.g. 'v_power_bi_consignment_summary'
  target_table text NOT NULL,               -- e.g. 'ft_consignments'
  enabled boolean DEFAULT true,             -- toggle individual steps on/off
  description text,                         -- human-readable description
  -- field_mapping: maps source column names → target column names
  -- e.g. {"id": "ft_id", "entity_code": "entity_code", "consignment_date": "consignment_date"}
  field_mapping jsonb NOT NULL DEFAULT '{}',
  -- transform_rules: optional per-field transformation instructions
  -- e.g. {"weight_kg": "extract_from_product_name", "produce_category": "derive_from_product"}
  transform_rules jsonb NOT NULL DEFAULT '{}',
  -- dedup_column: which target column to use for UPSERT conflict resolution
  dedup_column text NOT NULL DEFAULT 'ft_id',
  -- grower_resolve_field: which source field contains the entity code for grower_id resolution (null if not applicable)
  grower_resolve_field text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sync_source, target_table)
);

ALTER TABLE public.sync_config ENABLE ROW LEVEL SECURITY;

-- 2. RLS Policies

CREATE POLICY "Hub admin read sync config" ON public.sync_config
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');

CREATE POLICY "Hub admin manage sync config" ON public.sync_config
  FOR ALL USING (public.get_hub_role() = 'hub_admin');

CREATE POLICY "Module admin read sync config" ON public.sync_config
  FOR SELECT USING (public.has_capability('grower-portal', 'trigger_sync'));

CREATE POLICY "Service role manage sync config" ON public.sync_config
  FOR ALL USING (auth.role() = 'service_role');

-- 3. Auto-update trigger

CREATE TRIGGER sync_config_updated_at
  BEFORE UPDATE ON public.sync_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================================
-- 4. Seed default FreshTrack mappings
--
-- ⚠️  IMPORTANT: These field mappings are BEST GUESSES based on
--     the spec and typical FreshTrack v_power_bi_* view schemas.
--     The actual column names MUST be verified by running:
--       SELECT * FROM v_power_bi_xxx LIMIT 1
--     against the real FreshTrack database.
--     An admin can update these mappings via the Sync Config UI
--     once the actual column names are confirmed — no code deploy needed.
-- =============================================================

-- Step 1: Entities (synced first — used for grower resolution in later steps)
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_entities_view columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 1, 'v_power_bi_entities_view', 'ft_entities',
  'Sync grower/consignee/consignor entity details from FreshTrack',
  '{"id": "ft_id", "code": "entity_code", "name": "entity_name", "type": "entity_type", "abn": "abn", "address": "address", "email": "email", "phone": "phone", "active": "active"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  NULL
);

-- Step 2: Products (synced before consignments — used for category derivation)
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_products_view columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 2, 'v_power_bi_products_view', 'ft_products',
  'Sync product catalogue (varieties, grades, pack types) from FreshTrack',
  '{"id": "ft_id", "code": "product_code", "name": "product_name", "variety": "variety", "grade": "grade", "pack_type": "pack_type"}'::jsonb,
  '{"weight_kg": "extract_from_product_name", "produce_category": "derive_from_product"}'::jsonb,
  'ft_id',
  NULL
);

-- Step 3: Consignments (core sales data)
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_consignment_summary columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 3, 'v_power_bi_consignment_summary', 'ft_consignments',
  'Sync consignment/sales summary data from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "consignment_date": "consignment_date", "sale_date": "sale_date", "customer_name": "customer_name", "customer_code": "customer_code", "product_name": "product_name", "product_code": "product_code", "variety": "variety", "grade": "grade", "quantity": "quantity", "unit_price": "unit_price", "total_amount": "total_amount", "consignment_type": "consignment_type", "status": "status"}'::jsonb,
  '{"weight_kg": "calculate_from_quantity_and_product", "produce_category": "derive_from_product"}'::jsonb,
  'ft_id',
  'entity_code'
);

-- Step 4: Orders
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_orders_view columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 4, 'v_power_bi_orders_view', 'ft_orders',
  'Sync purchase orders and line items from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "order_number": "order_number", "order_date": "order_date", "delivery_date": "delivery_date", "customer_name": "customer_name", "customer_code": "customer_code", "product_name": "product_name", "product_code": "product_code", "variety": "variety", "grade": "grade", "quantity_ordered": "quantity_ordered", "quantity_dispatched": "quantity_dispatched", "unit_price": "unit_price", "total_amount": "total_amount", "status": "status"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  'entity_code'
);

-- Step 5: Pallets
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_pallet_box_details_view columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 5, 'v_power_bi_pallet_box_details_view', 'ft_pallets',
  'Sync pallet/box level detail data from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "pallet_number": "pallet_number", "consignment_date": "consignment_date", "product_name": "product_name", "product_code": "product_code", "variety": "variety", "grade": "grade", "box_count": "box_count", "weight_kg": "weight_kg", "customer_name": "customer_name", "dispatch_load_id": "dispatch_load_id"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  'entity_code'
);

-- Step 6: Dispatch loads
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_dispatch_load_view columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 6, 'v_power_bi_dispatch_load_view', 'ft_dispatch',
  'Sync dispatch load details and freight tracking from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "load_number": "load_number", "dispatch_date": "dispatch_date", "destination": "destination", "carrier": "carrier", "truck_rego": "truck_rego", "pallet_count": "pallet_count", "total_weight_kg": "total_weight_kg", "freight_cost": "freight_cost", "status": "status"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  'entity_code'
);

-- Step 7: Charges
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_charges columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 7, 'v_power_bi_charges', 'ft_charges',
  'Sync charge details (freight, commission, pallets) from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "consignment_id": "consignment_ft_id", "charge_type": "charge_type", "description": "description", "amount": "amount", "gst": "gst", "total_amount": "total_amount"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  'entity_code'
);

-- Step 8: Stock on hand
-- ⚠️ BEST GUESS mappings — verify against real v_power_bi_soh columns
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 8, 'v_power_bi_soh', 'ft_stock',
  'Sync current stock-on-hand levels from FreshTrack',
  '{"id": "ft_id", "entity_code": "entity_code", "product_name": "product_name", "product_code": "product_code", "variety": "variety", "grade": "grade", "quantity_on_hand": "quantity_on_hand", "weight_kg": "weight_kg", "location": "location", "stock_date": "stock_date"}'::jsonb,
  '{}'::jsonb,
  'ft_id',
  'entity_code'
);
