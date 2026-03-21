-- =============================================================
-- MM-Hub Migration 00004 — Grower Groups & Grower Admin
-- Adds parent grouping layer above growers (FreshTrack entities)
-- =============================================================

-- 1. Grower Groups — manually created parent businesses
CREATE TABLE public.grower_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  abn text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.grower_groups ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER grower_groups_updated_at
  BEFORE UPDATE ON public.grower_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Link growers (farms) to grower_groups
ALTER TABLE public.growers ADD COLUMN grower_group_id uuid REFERENCES public.grower_groups(id);
CREATE INDEX idx_growers_group ON public.growers(grower_group_id);

-- 3. RLS for grower_groups
CREATE POLICY "Hub admin read all grower_groups" ON public.grower_groups
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');

CREATE POLICY "Hub admin manage grower_groups" ON public.grower_groups
  FOR ALL USING (public.get_hub_role() = 'hub_admin');

CREATE POLICY "Portal staff read all grower_groups" ON public.grower_groups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access
      WHERE user_id = auth.uid() AND module_id = 'grower-portal'
      AND module_role IN ('admin', 'staff') AND active = true)
  );

CREATE POLICY "Grower read own group" ON public.grower_groups
  FOR SELECT USING (
    id = (
      SELECT (config->>'grower_group_id')::uuid FROM public.module_access
      WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
    )
  );

CREATE POLICY "Service write grower_groups" ON public.grower_groups
  FOR ALL USING (auth.role() = 'service_role');

-- 4. Update growers RLS — add policy for grower_group-scoped access
-- Users with grower_group_id in config can see all growers in their group
CREATE POLICY "Grower group member read growers" ON public.growers
  FOR SELECT USING (
    grower_group_id IS NOT NULL
    AND grower_group_id = (
      SELECT (config->>'grower_group_id')::uuid FROM public.module_access
      WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
    )
    AND (
      -- grower_admin sees all growers in their group
      EXISTS (
        SELECT 1 FROM public.module_access
        WHERE user_id = auth.uid() AND module_id = 'grower-portal'
        AND module_role = 'grower_admin' AND active = true
      )
      OR
      -- grower user: check grower_ids in config (null = all growers in group)
      (SELECT config->'grower_ids' FROM public.module_access
       WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
      ) IS NULL
      OR
      id::text IN (
        SELECT jsonb_array_elements_text(config->'grower_ids')
        FROM public.module_access
        WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
      )
    )
  );

-- 5. Grower admin RLS for module_access — can read users in same grower_group
CREATE POLICY "Grower admin read group users" ON public.module_access
  FOR SELECT USING (
    module_id = 'grower-portal'
    AND public.has_capability('grower-portal', 'manage_grower_users')
    AND config->>'grower_group_id' = (
      SELECT ma.config->>'grower_group_id' FROM public.module_access ma
      WHERE ma.user_id = auth.uid() AND ma.module_id = 'grower-portal' AND ma.active = true
    )
  );

-- 6. Helper functions
CREATE OR REPLACE FUNCTION public.get_portal_grower_group_id()
RETURNS uuid AS $$
  SELECT (config->>'grower_group_id')::uuid FROM public.module_access
  WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns NULL if user has access to ALL growers in their group
-- Returns uuid[] if user is restricted to specific growers
CREATE OR REPLACE FUNCTION public.get_portal_grower_ids()
RETURNS uuid[] AS $$
  SELECT
    CASE
      WHEN module_role IN ('admin', 'staff', 'grower_admin') THEN NULL
      WHEN config->'grower_ids' IS NULL OR config->>'grower_ids' = 'null' THEN NULL
      ELSE ARRAY(SELECT (jsonb_array_elements_text(config->'grower_ids'))::uuid)
    END
  FROM public.module_access
  WHERE user_id = auth.uid()
    AND module_id = 'grower-portal'
    AND active = true
$$ LANGUAGE sql SECURITY DEFINER STABLE;
