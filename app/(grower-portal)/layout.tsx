import { headers } from "next/headers";
import { requireModuleAccess, resolveGrowerPortalContext } from "@/lib/auth";
import { getModuleMenuItems } from "@/lib/modules";
import { MODULES } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { getPortalMode } from "@/lib/subdomain";
import { PortalShell } from "@/components/portal-shell";

export const dynamic = "force-dynamic";

export default async function GrowerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, access } = await requireModuleAccess("grower-portal");
  const context = resolveGrowerPortalContext(access);
  const moduleConfig = MODULES["grower-portal"];

  // Detect portal mode
  const headersList = headers();
  const hostname = headersList.get("host") || "localhost";
  const portalMode = getPortalMode(hostname);

  // Fetch grower name if user is scoped to a specific grower
  let growerName: string | null = null;
  if (context.growerId) {
    const supabase = createClient();
    const { data: grower } = await supabase
      .from("growers")
      .select("name")
      .eq("id", context.growerId)
      .single();
    growerName = grower?.name ?? null;
  }

  const menuItems = getModuleMenuItems(
    "grower-portal",
    context.allowedMenuItems
  );

  // In grower mode: never show module switcher, even for multi-module users
  const hasMultipleModules =
    portalMode === "grower"
      ? false
      : session.moduleAccess.length > 1 ||
        session.hubUser.hub_role === "hub_admin";

  // In grower mode: override the sidebar header name
  const effectiveConfig =
    portalMode === "grower"
      ? { ...moduleConfig, name: "Grower Portal" }
      : moduleConfig;

  return (
    <PortalShell
      moduleConfig={effectiveConfig}
      allowedMenuItems={menuItems}
      hubUser={session.hubUser}
      growerName={growerName}
      moduleRole={context.moduleRole}
      capabilities={context.capabilities}
      hasMultipleModules={hasMultipleModules}
      growerId={context.growerId}
      farmIds={context.farmIds}
      financialAccess={context.financialAccess}
    >
      {children}
    </PortalShell>
  );
}
