export type ModuleId = "grower-portal" | "payment-checker";

export interface ModuleConfig {
  id: ModuleId;
  name: string;
  basePath: string;
  icon: string;
  defaultPath: string;
  sidebarLogo?: "mackays" | "mm-hub";
  roles: ModuleRoleDefinition[];
  menuItems: MenuItem[];
}

export interface ModuleRoleDefinition {
  role: string;
  label: string;
  description: string;
  defaultMenuItems: string[];
  capabilities: string[];
}

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  icon: string;
}

export interface HubUser {
  id: string;
  name: string;
  email: string;
  auth_provider: "microsoft" | "email";
  hub_role: "hub_admin" | "user";
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface ModuleAccessRecord {
  id: string;
  user_id: string;
  module_id: ModuleId;
  module_role: string;
  config: Record<string, unknown>;
  active: boolean;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSession {
  hubUser: HubUser;
  moduleAccess: ModuleAccessRecord[];
}

export interface GrowerPortalConfig {
  grower_id: string | null;
  farm_ids: string[] | null;              // null = all farms, array = specific farms only
  allowed_menu_items: string[];
  financial_access: Record<string, boolean>;  // per menu item: true = see financials, false = hide
  capabilities: string[];
}

export interface GrowerPortalContext {
  moduleRole: "admin" | "staff" | "grower_admin" | "grower";
  growerId: string | null;
  farmIds: string[] | null;
  allowedMenuItems: string[];
  financialAccess: Record<string, boolean>;
  capabilities: string[];
}

export interface Farm {
  id: string;
  grower_id: string;
  name: string;
  code: string | null;
  freshtrack_farm_id: number | null;
  freshtrack_entity_code: string | null;
  location: string | null;
  region: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
