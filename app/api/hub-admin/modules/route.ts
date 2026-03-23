import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHubAdmin } from "@/lib/auth";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireHubAdmin();
  const supabase = createClient();

  // Get user counts per module + role
  const { data: accessRows } = await supabase
    .from("module_access")
    .select("module_id, module_role, active, user_id, hub_users!inner(name, email, active)")
    .order("module_id");

  // Build per-module stats
  const modules = Object.values(MODULES).map((mod) => {
    const moduleRows = (accessRows ?? []).filter(
      (r) => r.module_id === mod.id
    );
    const activeUsers = moduleRows.filter((r) => r.active);

    // Count users per role
    const roleCounts: Record<string, number> = {};
    for (const role of mod.roles) {
      roleCounts[role.role] = activeUsers.filter(
        (r) => r.module_role === role.role
      ).length;
    }

    return {
      id: mod.id,
      name: mod.name,
      icon: mod.icon,
      basePath: mod.basePath,
      totalUsers: moduleRows.length,
      activeUsers: activeUsers.length,
      roleCounts,
      roles: mod.roles.map((r) => ({
        role: r.role,
        label: r.label,
        description: r.description,
        capabilities: r.capabilities,
        defaultMenuItems: r.defaultMenuItems,
      })),
      menuItems: mod.menuItems.map((m) => ({
        id: m.id,
        label: m.label,
        icon: m.icon,
      })),
      users: moduleRows.map((r) => {
        // Supabase returns joined data; cast through unknown for safety
        const user = r.hub_users as unknown as { name: string; email: string; active: boolean } | null;
        return {
          userId: r.user_id,
          name: user?.name ?? "",
          email: user?.email ?? "",
          userActive: user?.active ?? false,
          role: r.module_role,
          active: r.active,
        };
      }),
    };
  });

  return NextResponse.json(modules);
}
