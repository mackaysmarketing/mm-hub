"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MackaysLogo } from "@/components/mackays-logo";
import type { ModuleConfig, MenuItem, HubUser } from "@/types/modules";
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  LineChart,
  Users,
  ClipboardCheck,
  RefreshCw,
  Settings,
  LogOut,
  Sprout,
  ArrowLeftRight,
  Menu,
  X,
  ClipboardList,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  LineChart,
  Users,
  ClipboardCheck,
  RefreshCw,
  Settings,
  LogOut,
  Sprout,
  ClipboardList,
  Truck,
  Warehouse,
};

interface AppSidebarProps {
  moduleConfig: ModuleConfig;
  allowedMenuItems: MenuItem[];
  hubUser: HubUser;
  growerName: string | null;
  moduleRole: string;
  capabilities: string[];
  hasMultipleModules: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export function AppSidebar({
  moduleConfig,
  allowedMenuItems,
  hubUser,
  growerName,
  moduleRole,
  capabilities,
  hasMultipleModules,
  isOpen,
  onClose,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleNavClick() {
    onClose?.();
  }

  const showManageSection =
    moduleRole === "admin" && capabilities.includes("manage_users");
  const showGrowerAdminSection =
    moduleRole === "grower_admin" &&
    capabilities.includes("manage_grower_users");

  const sidebarContent = (
    <aside className="flex h-screen w-[260px] flex-shrink-0 flex-col border-r border-sand bg-warmwhite">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sand px-4 py-5">
        <div>
          <MackaysLogo width={140} />
          <div className="mt-1 text-xs text-stone">{moduleConfig.name}</div>
        </div>
        <div className="flex items-center gap-1">
          {hasMultipleModules && (
            <Link
              href="/"
              className="rounded-md p-1.5 text-clay transition hover:bg-cream hover:text-soil"
              title="Switch module"
              onClick={handleNavClick}
            >
              <ArrowLeftRight size={16} />
            </Link>
          )}
          {/* Close button on mobile */}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-clay transition hover:bg-cream hover:text-soil lg:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5">
          {allowedMenuItems.map((item) => {
            const Icon = ICON_MAP[item.icon];
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/");

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={handleNavClick}
                  className={cn(
                    "mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition",
                    isActive
                      ? "border-l-[3px] border-canopy bg-parchment font-medium text-forest"
                      : "text-bark hover:bg-cream hover:text-soil"
                  )}
                >
                  {Icon && <Icon size={18} />}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {showManageSection && (
          <>
            <div className="mx-4 mt-6 mb-2 border-t border-sand pt-4">
              <span className="text-xs font-medium uppercase tracking-wider text-clay">
                Manage
              </span>
            </div>
            <ul className="space-y-0.5">
              {[
                { href: "/admin/growers", label: "Growers", icon: "Users" },
                {
                  href: "/admin/qa-entry",
                  label: "QA Entry",
                  icon: "ClipboardCheck",
                },
                {
                  href: "/admin/sync-status",
                  label: "Sync Status",
                  icon: "RefreshCw",
                },
              ].map((item) => {
                const Icon = ICON_MAP[item.icon];
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={handleNavClick}
                      className={cn(
                        "mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition",
                        isActive
                          ? "border-l-[3px] border-canopy bg-parchment font-medium text-forest"
                          : "text-bark hover:bg-cream hover:text-soil"
                      )}
                    >
                      {Icon && <Icon size={18} />}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {showGrowerAdminSection && (
          <>
            <div className="mx-4 mt-6 mb-2 border-t border-sand pt-4">
              <span className="text-xs font-medium uppercase tracking-wider text-clay">
                Admin
              </span>
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/settings/users"
                  onClick={handleNavClick}
                  className={cn(
                    "mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition",
                    pathname === "/settings/users" ||
                      pathname.startsWith("/settings/users/")
                      ? "border-l-[3px] border-canopy bg-parchment font-medium text-forest"
                      : "text-bark hover:bg-cream hover:text-soil"
                  )}
                >
                  <Users size={18} />
                  Users
                </Link>
              </li>
            </ul>
          </>
        )}
      </nav>

      {/* Hub Admin link — anchored above footer for hub_admin users */}
      {hubUser.hub_role === "hub_admin" && (
        <div className="border-t border-sand px-2 py-2">
          <Link
            href="/hub-admin/users"
            onClick={handleNavClick}
            className={cn(
              "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition",
              pathname.startsWith("/hub-admin")
                ? "border-l-[3px] border-canopy bg-parchment font-medium text-forest"
                : "text-bark hover:bg-cream hover:text-soil"
            )}
          >
            <Settings size={18} />
            Admin
          </Link>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-sand px-4 py-4">
        {growerName && (
          <p className="mb-1 text-sm font-medium text-soil">{growerName}</p>
        )}
        <p className="text-xs text-stone">{hubUser.name}</p>
        <p className="mb-3 text-xs text-stone">{hubUser.email}</p>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-xs text-clay transition hover:text-blaze"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar — always visible */}
      <div className="hidden lg:block">{sidebarContent}</div>

      {/* Mobile sidebar — overlay drawer */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-soil/40 lg:hidden"
            onClick={onClose}
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}

/** Hamburger button for mobile — place in top bar */
export function SidebarTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md p-1.5 text-bark transition hover:bg-cream hover:text-soil lg:hidden"
      aria-label="Open menu"
    >
      <Menu size={22} />
    </button>
  );
}
