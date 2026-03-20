"use client";

import { useState, type ReactNode } from "react";
import { AppSidebar, SidebarTrigger } from "@/components/app-sidebar";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import type { ModuleConfig, MenuItem, HubUser } from "@/types/modules";

interface PortalShellProps {
  moduleConfig: ModuleConfig;
  allowedMenuItems: MenuItem[];
  hubUser: HubUser;
  growerName: string | null;
  moduleRole: string;
  capabilities: string[];
  hasMultipleModules: boolean;
  children: ReactNode;
}

export function PortalShell({
  moduleConfig,
  allowedMenuItems,
  hubUser,
  growerName,
  moduleRole,
  capabilities,
  hasMultipleModules,
  children,
}: PortalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        moduleConfig={moduleConfig}
        allowedMenuItems={allowedMenuItems}
        hubUser={hubUser}
        growerName={growerName}
        moduleRole={moduleRole}
        capabilities={capabilities}
        hasMultipleModules={hasMultipleModules}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex flex-1 flex-col bg-parchment">
        {/* Mobile top bar with hamburger + freshness badge */}
        <div className="flex h-12 items-center justify-between border-b border-sand bg-warmwhite px-4 lg:hidden">
          <SidebarTrigger onClick={() => setSidebarOpen(true)} />
          <DataFreshnessBadge />
        </div>
        {/* Desktop freshness badge — floated in top-right */}
        <div className="hidden lg:flex h-8 items-center justify-end px-6 pt-2">
          <DataFreshnessBadge />
        </div>
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
