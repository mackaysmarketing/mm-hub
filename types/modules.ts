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
  allowed_menu_items: string[];
  capabilities: string[];
}

export interface GrowerPortalContext {
  moduleRole: "admin" | "staff" | "grower";
  growerId: string | null;
  allowedMenuItems: string[];
  capabilities: string[];
}
