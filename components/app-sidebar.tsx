"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
};

interface AppSidebarProps {
  moduleConfig: ModuleConfig;
  allowedMenuItems: MenuItem[];
  hubUser: HubUser;
  growerName: string | null;
  moduleRole: string;
  capabilities: string[];
  hasMultipleModules: boolean;
}

export function AppSidebar({
  moduleConfig,
  allowedMenuItems,
  hubUser,
  growerName,
  moduleRole,
  capabilities,
  hasMultipleModules,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const showManageSection =
    moduleRole === "admin" && capabilities.includes("manage_users");

  return (
    <aside className="flex h-screen w-[260px] flex-shrink-0 flex-col border-r border-sand bg-warmwhite">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sand px-4 py-5">
        <div>
          <div className="font-display text-lg font-bold text-forest">
            MACKAYS
          </div>
          <div className="text-xs text-stone">{moduleConfig.name}</div>
        </div>
        {hasMultipleModules && (
          <Link
            href="/"
            className="rounded-md p-1.5 text-clay transition hover:bg-cream hover:text-soil"
            title="Switch module"
          >
            <ArrowLeftRight size={16} />
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5">
          {allowedMenuItems.map((item) => {
            const Icon = ICON_MAP[item.icon];
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
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
                { href: "/admin/qa-entry", label: "QA Entry", icon: "ClipboardCheck" },
                { href: "/admin/sync-status", label: "Sync Status", icon: "RefreshCw" },
              ].map((item) => {
                const Icon = ICON_MAP[item.icon];
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
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
      </nav>

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
}
