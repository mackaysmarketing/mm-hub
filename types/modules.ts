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
  grower_group_id: string | null;        // which grower_group this user belongs to
  grower_ids: string[] | null;           // null = all growers in group, array = specific growers only
  allowed_menu_items: string[];
  financial_access: Record<string, boolean>;  // per menu item: true = see financials, false = hide
  capabilities: string[];
}

export interface GrowerPortalContext {
  growerGroupId: string | null;
  growerIds: string[] | null;
  financialAccess: Record<string, boolean>;
  moduleRole: string;
  capabilities: string[];
  menuItems: string[];
}

export interface Grower {
  id: string;
  name: string;
  code: string | null;
  freshtrack_code: string | null;
  grower_group_id: string | null;
  region: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GrowerGroup {
  id: string;
  name: string;
  code: string | null;
  abn: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
