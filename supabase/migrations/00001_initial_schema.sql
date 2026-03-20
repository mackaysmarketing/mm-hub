-- =============================================================
-- MM-Hub Initial Schema — Two-Tier Access Model
-- =============================================================

-- 1. Hub-level tables

CREATE TABLE public.hub_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  auth_provider text NOT NULL CHECK (auth_provider IN ('microsoft', 'email')),
  hub_role text NOT NULL DEFAULT 'user' CHECK (hub_role IN ('hub_admin', 'user')),
  active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.hub_users(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  module_role text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  active boolean DEFAULT true,
  granted_by uuid REFERENCES public.hub_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, module_id)
);

CREATE INDEX idx_module_access_user ON public.module_access(user_id);
CREATE INDEX idx_module_access_module ON public.module_access(module_id);
CREATE INDEX idx_module_access_module_role ON public.module_access(module_id, module_role);

-- 2. Grower Portal domain tables

CREATE TABLE public.growers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  freshtrack_code text UNIQUE,
  freshtrack_entity_id integer,
  abn text,
  address text,
  email text,
  phone text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Remittance tables (NetSuite sync target)

CREATE TABLE public.remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id uuid NOT NULL REFERENCES public.growers(id),
  netsuite_id text UNIQUE,
  rcti_ref text,
  payment_date date,
  grower_name text,
  grower_abn text,
  total_gross numeric(12,2),
  total_deductions_ex_gst numeric(12,2),
  total_deductions_gst numeric(12,2),
  total_deductions numeric(12,2),
  total_invoiced numeric(12,2),
  total_quantity integer,
  netsuite_pdf_url text,
  status text DEFAULT 'processed',
  synced_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.remittance_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id uuid NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
  netsuite_line_id text,
  sale_date date,
  dispatch_date date,
  origin_load text,
  destination text,
  po_number text,
  manifest text,
  customer_ref text,
  consignee_code text,
  product text,
  description text,
  quantity integer,
  unit_price numeric(10,2),
  total_amount numeric(12,2),
  customer text,
  produce_category text,
  grade text
);

CREATE TABLE public.remittance_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id uuid NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
  line_item_id uuid REFERENCES public.remittance_line_items(id),
  charge_type text,
  ex_gst numeric(10,2),
  gst numeric(10,2),
  total_amount numeric(10,2)
);

-- 4. QA & Compliance tables

CREATE TABLE public.qa_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id uuid NOT NULL REFERENCES public.growers(id),
  assessment_date date NOT NULL,
  assessed_by uuid REFERENCES public.hub_users(id),
  overall_score numeric(5,2),
  status text CHECK (status IN ('compliant', 'at_risk', 'non_compliant')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.qa_category_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.qa_assessments(id) ON DELETE CASCADE,
  category text NOT NULL,
  score numeric(5,2),
  max_score numeric(5,2) DEFAULT 100,
  status text CHECK (status IN ('pass', 'warning', 'fail')),
  findings text,
  action_required text,
  due_date date
);

CREATE TABLE public.qa_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id uuid NOT NULL REFERENCES public.growers(id),
  audit_type text NOT NULL,
  scheduled_date date,
  completed_date date,
  auditor text,
  result text CHECK (result IN ('pass', 'conditional_pass', 'fail')),
  certificate_expiry date,
  notes text,
  document_id uuid,
  created_at timestamptz DEFAULT now()
);

-- 5. Documents

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grower_id uuid NOT NULL REFERENCES public.growers(id),
  name text NOT NULL,
  category text CHECK (category IN ('compliance', 'certificate', 'agreements', 'unpaid_lots', 'general')),
  storage_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by uuid REFERENCES public.hub_users(id),
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE public.qa_audits
  ADD CONSTRAINT qa_audits_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.documents(id);

-- 6. FreshTrack sync tables

CREATE TABLE public.ft_consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, consignment_date date, sale_date date,
  customer_name text, customer_code text, product_name text, product_code text,
  variety text, grade text, produce_category text,
  quantity integer, weight_kg numeric(10,2), unit_price numeric(10,2), total_amount numeric(12,2),
  consignment_type text, status text, synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, order_number text, order_date date, delivery_date date,
  customer_name text, customer_code text, product_name text, product_code text,
  variety text, grade text, quantity_ordered integer, quantity_dispatched integer,
  unit_price numeric(10,2), total_amount numeric(12,2), status text,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, pallet_number text, consignment_date date,
  product_name text, product_code text, variety text, grade text,
  box_count integer, weight_kg numeric(10,2), customer_name text,
  dispatch_load_id bigint, synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, load_number text, dispatch_date date, destination text,
  carrier text, truck_rego text, pallet_count integer,
  total_weight_kg numeric(10,2), freight_cost numeric(10,2), status text,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, entity_code text UNIQUE, entity_name text,
  entity_type text, abn text, address text, email text, phone text,
  active boolean, synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, product_code text UNIQUE, product_name text,
  variety text, grade text, pack_type text, weight_kg numeric(10,2),
  produce_category text, active boolean, synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, consignment_ft_id bigint, charge_type text,
  description text, amount numeric(10,2), gst numeric(10,2),
  total_amount numeric(10,2), synced_at timestamptz DEFAULT now()
);

CREATE TABLE public.ft_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ft_id bigint UNIQUE, grower_id uuid REFERENCES public.growers(id),
  entity_code text, product_name text, product_code text,
  variety text, grade text, quantity_on_hand integer,
  weight_kg numeric(10,2), location text, stock_date date,
  synced_at timestamptz DEFAULT now()
);

-- 7. Sync logging

CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('freshtrack', 'netsuite')),
  sync_type text CHECK (sync_type IN ('full', 'incremental')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  records_synced integer DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 8. Auto-update triggers

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER growers_updated_at BEFORE UPDATE ON public.growers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER qa_assessments_updated_at BEFORE UPDATE ON public.qa_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER module_access_updated_at BEFORE UPDATE ON public.module_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 9. Auth trigger — auto-create hub_users on signup

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.hub_users (id, name, email, auth_provider, hub_role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    CASE WHEN NEW.raw_app_meta_data->>'provider' = 'azure' THEN 'microsoft' ELSE 'email' END,
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. RLS Helper Functions

CREATE OR REPLACE FUNCTION public.get_hub_role()
RETURNS text AS $$
  SELECT hub_role FROM public.hub_users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_module_access(p_module_id text)
RETURNS TABLE (module_role text, config jsonb) AS $$
  SELECT module_role, config FROM public.module_access
  WHERE user_id = auth.uid() AND module_id = p_module_id AND active = true
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_portal_grower_id()
RETURNS uuid AS $$
  SELECT (config->>'grower_id')::uuid FROM public.module_access
  WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND active = true
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.has_capability(p_module_id text, p_capability text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_access
    WHERE user_id = auth.uid() AND module_id = p_module_id
      AND active = true AND config->'capabilities' ? p_capability
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 11. Row Level Security — Enable on ALL tables

ALTER TABLE public.hub_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remittance_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_category_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_pallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- hub_users policies
-- =============================================
CREATE POLICY "Users read own profile" ON public.hub_users
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "Hub admin read all" ON public.hub_users
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Hub admin manage" ON public.hub_users
  FOR ALL USING (public.get_hub_role() = 'hub_admin');

-- =============================================
-- module_access policies
-- =============================================
CREATE POLICY "Users read own access" ON public.module_access
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Hub admin manage all access" ON public.module_access
  FOR ALL USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Module admin read module access" ON public.module_access
  FOR SELECT USING (
    module_id IN (SELECT ma.module_id FROM public.module_access ma WHERE ma.user_id = auth.uid() AND ma.active = true AND ma.config->'capabilities' ? 'manage_users')
  );
CREATE POLICY "Module admin insert module access" ON public.module_access
  FOR INSERT WITH CHECK (
    module_id IN (SELECT ma.module_id FROM public.module_access ma WHERE ma.user_id = auth.uid() AND ma.active = true AND ma.config->'capabilities' ? 'manage_users')
  );
CREATE POLICY "Module admin update module access" ON public.module_access
  FOR UPDATE USING (
    module_id IN (SELECT ma.module_id FROM public.module_access ma WHERE ma.user_id = auth.uid() AND ma.active = true AND ma.config->'capabilities' ? 'manage_users')
  );

-- =============================================
-- growers policies
-- =============================================
CREATE POLICY "Portal staff read all growers" ON public.growers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own" ON public.growers
  FOR SELECT USING (id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all growers" ON public.growers
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');

-- =============================================
-- remittances policies
-- =============================================
CREATE POLICY "Portal staff read all remittances" ON public.remittances
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own remittances" ON public.remittances
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all remittances" ON public.remittances
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write remittances" ON public.remittances
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- remittance_line_items policies (join via remittance_id)
-- =============================================
CREATE POLICY "Portal staff read all remittance_line_items" ON public.remittance_line_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own remittance_line_items" ON public.remittance_line_items
  FOR SELECT USING (
    remittance_id IN (SELECT r.id FROM public.remittances r WHERE r.grower_id = public.get_portal_grower_id())
  );
CREATE POLICY "Hub admin read all remittance_line_items" ON public.remittance_line_items
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write remittance_line_items" ON public.remittance_line_items
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- remittance_charges policies (join via remittance_id)
-- =============================================
CREATE POLICY "Portal staff read all remittance_charges" ON public.remittance_charges
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own remittance_charges" ON public.remittance_charges
  FOR SELECT USING (
    remittance_id IN (SELECT r.id FROM public.remittances r WHERE r.grower_id = public.get_portal_grower_id())
  );
CREATE POLICY "Hub admin read all remittance_charges" ON public.remittance_charges
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write remittance_charges" ON public.remittance_charges
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- qa_assessments policies
-- =============================================
CREATE POLICY "Portal staff read all qa_assessments" ON public.qa_assessments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own qa_assessments" ON public.qa_assessments
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all qa_assessments" ON public.qa_assessments
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write qa_assessments" ON public.qa_assessments
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- qa_category_scores policies (join via assessment_id)
-- =============================================
CREATE POLICY "Portal staff read all qa_category_scores" ON public.qa_category_scores
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own qa_category_scores" ON public.qa_category_scores
  FOR SELECT USING (
    assessment_id IN (SELECT qa.id FROM public.qa_assessments qa WHERE qa.grower_id = public.get_portal_grower_id())
  );
CREATE POLICY "Hub admin read all qa_category_scores" ON public.qa_category_scores
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write qa_category_scores" ON public.qa_category_scores
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- qa_audits policies
-- =============================================
CREATE POLICY "Portal staff read all qa_audits" ON public.qa_audits
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own qa_audits" ON public.qa_audits
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all qa_audits" ON public.qa_audits
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write qa_audits" ON public.qa_audits
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- documents policies
-- =============================================
CREATE POLICY "Portal staff read all documents" ON public.documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own documents" ON public.documents
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all documents" ON public.documents
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write documents" ON public.documents
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_consignments policies
-- =============================================
CREATE POLICY "Portal staff read all ft_consignments" ON public.ft_consignments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_consignments" ON public.ft_consignments
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_consignments" ON public.ft_consignments
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_consignments" ON public.ft_consignments
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_orders policies
-- =============================================
CREATE POLICY "Portal staff read all ft_orders" ON public.ft_orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_orders" ON public.ft_orders
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_orders" ON public.ft_orders
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_orders" ON public.ft_orders
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_pallets policies
-- =============================================
CREATE POLICY "Portal staff read all ft_pallets" ON public.ft_pallets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_pallets" ON public.ft_pallets
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_pallets" ON public.ft_pallets
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_pallets" ON public.ft_pallets
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_dispatch policies
-- =============================================
CREATE POLICY "Portal staff read all ft_dispatch" ON public.ft_dispatch
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_dispatch" ON public.ft_dispatch
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_dispatch" ON public.ft_dispatch
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_dispatch" ON public.ft_dispatch
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_charges policies
-- =============================================
CREATE POLICY "Portal staff read all ft_charges" ON public.ft_charges
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_charges" ON public.ft_charges
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_charges" ON public.ft_charges
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_charges" ON public.ft_charges
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_stock policies
-- =============================================
CREATE POLICY "Portal staff read all ft_stock" ON public.ft_stock
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own ft_stock" ON public.ft_stock
  FOR SELECT USING (grower_id = public.get_portal_grower_id());
CREATE POLICY "Hub admin read all ft_stock" ON public.ft_stock
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write ft_stock" ON public.ft_stock
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_entities policies (special: entity_code match, not grower_id)
-- =============================================
CREATE POLICY "Portal staff read all entities" ON public.ft_entities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.module_access WHERE user_id = auth.uid() AND module_id = 'grower-portal' AND module_role IN ('admin', 'staff') AND active = true)
  );
CREATE POLICY "Grower read own entity" ON public.ft_entities
  FOR SELECT USING (
    entity_code = (SELECT g.freshtrack_code FROM public.growers g WHERE g.id = public.get_portal_grower_id())
  );
CREATE POLICY "Hub admin read all entities" ON public.ft_entities
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Service write entities" ON public.ft_entities
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- ft_products policies (all authenticated can read)
-- =============================================
CREATE POLICY "Authenticated read products" ON public.ft_products
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Service write products" ON public.ft_products
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- sync_logs policies
-- =============================================
CREATE POLICY "Hub admin read sync logs" ON public.sync_logs
  FOR SELECT USING (public.get_hub_role() = 'hub_admin');
CREATE POLICY "Module admin read sync logs" ON public.sync_logs
  FOR SELECT USING (public.has_capability('grower-portal', 'trigger_sync'));
CREATE POLICY "Service write sync logs" ON public.sync_logs
  FOR ALL USING (auth.role() = 'service_role');

-- 12. Indexes

CREATE INDEX idx_ft_consignments_grower ON public.ft_consignments(grower_id);
CREATE INDEX idx_ft_consignments_date ON public.ft_consignments(consignment_date);
CREATE INDEX idx_ft_consignments_customer ON public.ft_consignments(customer_name);
CREATE INDEX idx_ft_orders_grower ON public.ft_orders(grower_id);
CREATE INDEX idx_ft_pallets_grower ON public.ft_pallets(grower_id);
CREATE INDEX idx_ft_dispatch_grower ON public.ft_dispatch(grower_id);
CREATE INDEX idx_ft_charges_grower ON public.ft_charges(grower_id);
CREATE INDEX idx_ft_stock_grower ON public.ft_stock(grower_id);
CREATE INDEX idx_remittances_grower ON public.remittances(grower_id);
CREATE INDEX idx_remittance_lines_remittance ON public.remittance_line_items(remittance_id);
CREATE INDEX idx_qa_assessments_grower ON public.qa_assessments(grower_id);
CREATE INDEX idx_documents_grower ON public.documents(grower_id);
CREATE INDEX idx_sync_logs_source ON public.sync_logs(source, started_at DESC);
