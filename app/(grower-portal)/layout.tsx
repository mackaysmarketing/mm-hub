import { requireModuleAccess, resolveGrowerPortalContext } from "@/lib/auth";
import { getModuleMenuItems } from "@/lib/modules";
import { MODULES } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

export const dynamic = "force-dynamic";

export default async function GrowerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, access } = await requireModuleAccess("grower-portal");
  const context = resolveGrowerPortalContext(access);
  const moduleConfig = MODULES["grower-portal"];

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

  const hasMultipleModules =
    session.moduleAccess.length > 1 ||
    session.hubUser.hub_role === "hub_admin";

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        moduleConfig={moduleConfig}
        allowedMenuItems={menuItems}
        hubUser={session.hubUser}
        growerName={growerName}
        moduleRole={context.moduleRole}
        capabilities={context.capabilities}
        hasMultipleModules={hasMultipleModules}
      />
      <div className="flex flex-1 flex-col bg-parchment">
        <main className="flex-1 p-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
