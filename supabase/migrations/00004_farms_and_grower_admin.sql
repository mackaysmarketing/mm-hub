-- =============================================================
-- MM-Hub Migration 00004 — Farms, grower_admin role, farm-level access
-- =============================================================

-- 1. Farms table — linked to growers, synced from FreshTrack
CREATE TABLE public.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id uuid NOT NULL REFERENCES public.growers(id),
  name text NOT NULL,
  code text,
  freshtrack_farm_id integer UNIQUE,
  freshtrack_entity_code text,
  location text,
  region text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_farms_grower ON public.farms(grower_id);

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

-- Hub admin reads all farms
CREATE POLICY "Hub admin read all farms" ON public.farms
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');

-- Portal staff/admin read all farms
CREATE POLICY "Portal staff read all farms" ON public.farms
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access
      WHERE user_id = auth.uid() AND module_id = 'grower-portal'
      AND module_role IN ('admin', 'staff') AND active = true)
  );

-- Grower admin reads own grower's farms
-- Grower user reads only their assigned farms
CREATE POLICY "Grower read accessible farms" ON public.farms
  FOR SELECT USING (
    grower_id = public.get_portal_grower_id()
    AND (
      -- grower_admin sees all farms for their grower
      EXISTS (
        SELECT 1 FROM public.module_access
        WHERE user_id = auth.uid() AND module_id = 'grower-portal'
        AND module_role = 'grower_admin' AND active = true
      )
      OR
      -- grower user: check farm_ids in their config (null = all farms)
      (SELECT config->'farm_ids' FROM public.module_access
       WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
      ) IS NULL
      OR
      id::text IN (
        SELECT jsonb_array_elements_text(config->'farm_ids')
        FROM public.module_access
        WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
      )
    )
  );

CREATE POLICY "Hub admin manage farms" ON public.farms
  FOR ALL USING (public.get_hub_role() = 'hub_admin');

CREATE POLICY "Service write farms" ON public.farms
  FOR ALL USING (auth.role() = 'service_role');

CREATE TRIGGER farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Add farm_id column to FreshTrack tables
ALTER TABLE public.ft_consignments ADD COLUMN farm_id uuid REFERENCES public.farms(id);
ALTER TABLE public.ft_orders ADD COLUMN farm_id uuid REFERENCES public.farms(id);
ALTER TABLE public.ft_pallets ADD COLUMN farm_id uuid REFERENCES public.farms(id);
ALTER TABLE public.ft_dispatch ADD COLUMN farm_id uuid REFERENCES public.farms(id);
ALTER TABLE public.ft_charges ADD COLUMN farm_id uuid REFERENCES public.farms(id);
ALTER TABLE public.ft_stock ADD COLUMN farm_id uuid REFERENCES public.farms(id);

CREATE INDEX idx_ft_consignments_farm ON public.ft_consignments(farm_id);
CREATE INDEX idx_ft_orders_farm ON public.ft_orders(farm_id);
CREATE INDEX idx_ft_pallets_farm ON public.ft_pallets(farm_id);
CREATE INDEX idx_ft_dispatch_farm ON public.ft_dispatch(farm_id);
CREATE INDEX idx_ft_charges_farm ON public.ft_charges(farm_id);
CREATE INDEX idx_ft_stock_farm ON public.ft_stock(farm_id);

-- 3. RLS helper function: get accessible farm_ids for current user
-- Returns NULL if user has access to ALL farms (admin/staff/grower_admin, or grower with farm_ids=null)
CREATE OR REPLACE FUNCTION public.get_portal_farm_ids()
RETURNS uuid[] AS $$
  SELECT
    CASE
      WHEN module_role IN ('admin', 'staff', 'grower_admin') THEN NULL
      WHEN config->'farm_ids' IS NULL OR config->>'farm_ids' = 'null' THEN NULL
      ELSE ARRAY(SELECT (jsonb_array_elements_text(config->'farm_ids'))::uuid)
    END
  FROM public.module_access
  WHERE user_id = auth.uid()
    AND module_id = 'grower-portal'
    AND active = true
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. Add farm sync config row
INSERT INTO public.sync_config (sync_source, step_order, source_view, target_table, enabled, description, field_mapping, transform_rules, dedup_column, grower_resolve_field)
VALUES (
  'freshtrack', 9, 'farm', 'farms',
  true, 'Sync farm records from FreshTrack — BEST GUESS: actual table/view and column names need verification',
  '{"id": "freshtrack_farm_id", "name": "name", "code": "code", "entity_code": "freshtrack_entity_code", "location": "location", "region": "region", "active": "active"}'::jsonb,
  '{}'::jsonb,
  'freshtrack_farm_id',
  'entity_code'
);

-- 5. Update growers RLS: grower_admin users should also read their grower
CREATE POLICY "Grower admin read own grower" ON public.growers
  FOR SELECT USING (
    id = public.get_portal_grower_id()
    AND EXISTS (
      SELECT 1 FROM public.module_access
      WHERE user_id = auth.uid() AND module_id = 'grower-portal'
      AND module_role = 'grower_admin' AND active = true
    )
  );

-- 6. Allow grower_admin to read module_access for their grower's users
-- (needed for grower admin user management)
CREATE POLICY "Grower admin read grower users" ON public.module_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.module_access ma
      WHERE ma.user_id = auth.uid()
        AND ma.module_id = 'grower-portal'
        AND ma.module_role = 'grower_admin'
        AND ma.active = true
    )
    AND module_id = 'grower-portal'
    AND config->>'grower_id' = (
      SELECT ma2.config->>'grower_id' FROM public.module_access ma2
      WHERE ma2.user_id = auth.uid() AND ma2.module_id = 'grower-portal' AND ma2.active = true
    )
  );
