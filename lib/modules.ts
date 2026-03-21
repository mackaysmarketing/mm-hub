import type { ModuleId, ModuleConfig, MenuItem } from "@/types/modules";

export const MODULES: Record<ModuleId, ModuleConfig> = {
  "grower-portal": {
    id: "grower-portal",
    name: "Grower Portal",
    basePath: "/",
    defaultPath: "/dashboard",
    icon: "Sprout",
    sidebarLogo: "mackays",
    roles: [
      {
        role: "admin",
        label: "Module Admin",
        description:
          "Full access — manage module users, QA entry, view all growers, sync controls",
        defaultMenuItems: [
          "Dashboard",
          "Sales & Pricing",
          "QA & Compliance",
          "Forecasting",
          "Remittances",
          "Documents",
        ],
        capabilities: [
          "manage_users",
          "view_all_growers",
          "enter_qa",
          "trigger_sync",
        ],
      },
      {
        role: "staff",
        label: "Staff",
        description: "View all grower data, limited admin",
        defaultMenuItems: [
          "Dashboard",
          "Sales & Pricing",
          "QA & Compliance",
          "Forecasting",
          "Remittances",
          "Documents",
        ],
        capabilities: ["view_all_growers"],
      },
      {
        role: "grower_admin",
        label: "Grower Admin",
        description:
          "Grower-side admin — manages users within their own grower entity, sees all farms",
        defaultMenuItems: [
          "Dashboard",
          "Sales & Pricing",
          "QA & Compliance",
          "Remittances",
          "Documents",
        ],
        capabilities: ["manage_grower_users", "view_all_farms"],
      },
      {
        role: "grower",
        label: "Grower",
        description: "View own data only — scoped by grower_id",
        defaultMenuItems: [
          "Dashboard",
          "Sales & Pricing",
          "Remittances",
          "Documents",
        ],
        capabilities: [],
      },
    ],
    menuItems: [
      {
        id: "Dashboard",
        label: "Dashboard",
        href: "/dashboard",
        icon: "LayoutDashboard",
      },
      {
        id: "Sales & Pricing",
        label: "Sales & Pricing",
        href: "/sales",
        icon: "TrendingUp",
      },
      {
        id: "Remittances",
        label: "Remittances",
        href: "/remittances",
        icon: "Receipt",
      },
      {
        id: "Documents",
        label: "Documents",
        href: "/documents",
        icon: "FileText",
      },
      {
        id: "QA & Compliance",
        label: "QA & Compliance",
        href: "/qa",
        icon: "ShieldCheck",
      },
      {
        id: "Forecasting",
        label: "Forecasting",
        href: "/forecasting",
        icon: "LineChart",
      },
    ],
  },
  "payment-checker": {
    id: "payment-checker",
    name: "Payment Checker",
    basePath: "/payment-checker",
    defaultPath: "/payment-checker",
    icon: "CircleDollarSign",
    roles: [],
    menuItems: [],
  },
};

export function getModuleById(id: ModuleId): ModuleConfig | undefined {
  return MODULES[id];
}

export function getModuleMenuItems(
  moduleId: ModuleId,
  allowedMenuItems: string[]
): MenuItem[] {
  const mod = MODULES[moduleId];
  if (!mod) return [];
  return mod.menuItems.filter((item) => allowedMenuItems.includes(item.id));
}

export function getDefaultMenuItemsForRole(
  moduleId: ModuleId,
  role: string
): string[] {
  const mod = MODULES[moduleId];
  if (!mod) return [];
  const roleDef = mod.roles.find((r) => r.role === role);
  return roleDef?.defaultMenuItems ?? [];
}

export function getDefaultCapabilitiesForRole(
  moduleId: ModuleId,
  role: string
): string[] {
  const mod = MODULES[moduleId];
  if (!mod) return [];
  const roleDef = mod.roles.find((r) => r.role === role);
  return roleDef?.capabilities ?? [];
}
