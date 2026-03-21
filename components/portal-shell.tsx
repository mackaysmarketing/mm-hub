"use client";

import { useState, createContext, useContext, type ReactNode } from "react";
import { AppSidebar, SidebarTrigger } from "@/components/app-sidebar";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { GrowerSwitcher } from "@/components/grower-switcher";
import { useGrowerContext } from "@/hooks/use-grower-context";
import type { ModuleConfig, MenuItem, HubUser, GrowerPortalContext } from "@/types/modules";

interface PortalShellProps {
  moduleConfig: ModuleConfig;
  allowedMenuItems: MenuItem[];
  hubUser: HubUser;
  growerName: string | null;
  moduleRole: string;
  capabilities: string[];
  hasMultipleModules: boolean;
  growerGroupId?: string | null;
  growerIds?: string[] | null;
  financialAccess?: Record<string, boolean>;
  children: ReactNode;
}

// Context to expose grower selection and financial access to child pages
interface PortalDataContext {
  selectedGrowerId: string | null;
  setSelectedGrowerId: (id: string | null) => void;
  financialAccess: Record<string, boolean>;
}

const PortalDataCtx = createContext<PortalDataContext>({
  selectedGrowerId: null,
  setSelectedGrowerId: () => {},
  financialAccess: {},
});

export function usePortalData() {
  return useContext(PortalDataCtx);
}

export function PortalShell({
  moduleConfig,
  allowedMenuItems,
  hubUser,
  growerName,
  moduleRole,
  capabilities,
  hasMultipleModules,
  growerGroupId,
  growerIds,
  financialAccess = {},
  children,
}: PortalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Grower context
  const portalContext: GrowerPortalContext = {
    moduleRole,
    growerGroupId: growerGroupId ?? null,
    growerIds: growerIds ?? null,
    menuItems: allowedMenuItems.map((m) => m.id),
    financialAccess,
    capabilities,
  };
  const growerCtx = useGrowerContext(portalContext);

  return (
    <PortalDataCtx.Provider
      value={{
        selectedGrowerId: growerCtx.selectedGrowerId,
        setSelectedGrowerId: growerCtx.setSelectedGrowerId,
        financialAccess,
      }}
    >
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
          {/* Mobile top bar with hamburger + grower switcher + freshness badge */}
          <div className="flex h-12 items-center justify-between border-b border-sand bg-warmwhite px-4 lg:hidden">
            <SidebarTrigger onClick={() => setSidebarOpen(true)} />
            <div className="flex items-center gap-2">
              {growerCtx.showGrowerSwitcher && (
                <GrowerSwitcher
                  growers={growerCtx.growers}
                  selectedGrowerId={growerCtx.selectedGrowerId}
                  onChange={growerCtx.setSelectedGrowerId}
                />
              )}
              <DataFreshnessBadge />
            </div>
          </div>
          {/* Desktop top strip — grower switcher + freshness badge */}
          <div className="hidden lg:flex h-8 items-center justify-end gap-3 px-6 pt-2">
            {growerCtx.showGrowerSwitcher && (
              <GrowerSwitcher
                growers={growerCtx.growers}
                selectedGrowerId={growerCtx.selectedGrowerId}
                onChange={growerCtx.setSelectedGrowerId}
              />
            )}
            <DataFreshnessBadge />
          </div>
          <main className="flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </PortalDataCtx.Provider>
  );
}
