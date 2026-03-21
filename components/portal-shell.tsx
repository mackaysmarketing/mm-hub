"use client";

import { useState, createContext, useContext, type ReactNode } from "react";
import { AppSidebar, SidebarTrigger } from "@/components/app-sidebar";
import { DataFreshnessBadge } from "@/components/data-freshness-badge";
import { FarmSelector } from "@/components/farm-selector";
import { useFarmContext } from "@/hooks/use-farm-context";
import type { ModuleConfig, MenuItem, HubUser, GrowerPortalContext } from "@/types/modules";

interface PortalShellProps {
  moduleConfig: ModuleConfig;
  allowedMenuItems: MenuItem[];
  hubUser: HubUser;
  growerName: string | null;
  moduleRole: string;
  capabilities: string[];
  hasMultipleModules: boolean;
  growerId?: string | null;
  farmIds?: string[] | null;
  financialAccess?: Record<string, boolean>;
  children: ReactNode;
}

// Context to expose farm selection and financial access to child pages
interface PortalDataContext {
  selectedFarmId: string | null;
  setSelectedFarmId: (id: string | null) => void;
  financialAccess: Record<string, boolean>;
}

const PortalDataCtx = createContext<PortalDataContext>({
  selectedFarmId: null,
  setSelectedFarmId: () => {},
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
  growerId,
  farmIds,
  financialAccess = {},
  children,
}: PortalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Farm context
  const portalContext: GrowerPortalContext = {
    moduleRole: moduleRole as GrowerPortalContext["moduleRole"],
    growerId: growerId ?? null,
    farmIds: farmIds ?? null,
    allowedMenuItems: allowedMenuItems.map((m) => m.id),
    financialAccess,
    capabilities,
  };
  const farmCtx = useFarmContext(portalContext);

  return (
    <PortalDataCtx.Provider
      value={{
        selectedFarmId: farmCtx.selectedFarmId,
        setSelectedFarmId: farmCtx.setSelectedFarmId,
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
          {/* Mobile top bar with hamburger + farm selector + freshness badge */}
          <div className="flex h-12 items-center justify-between border-b border-sand bg-warmwhite px-4 lg:hidden">
            <SidebarTrigger onClick={() => setSidebarOpen(true)} />
            <div className="flex items-center gap-2">
              {farmCtx.showFarmSwitcher && (
                <FarmSelector
                  farms={farmCtx.farms}
                  selectedFarmId={farmCtx.selectedFarmId}
                  onChange={farmCtx.setSelectedFarmId}
                />
              )}
              <DataFreshnessBadge />
            </div>
          </div>
          {/* Desktop top strip — farm selector + freshness badge */}
          <div className="hidden lg:flex h-8 items-center justify-end gap-3 px-6 pt-2">
            {farmCtx.showFarmSwitcher && (
              <FarmSelector
                farms={farmCtx.farms}
                selectedFarmId={farmCtx.selectedFarmId}
                onChange={farmCtx.setSelectedFarmId}
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
