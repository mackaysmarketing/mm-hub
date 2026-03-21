import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  UserSession,
  ModuleAccessRecord,
  GrowerPortalContext,
} from "@/types/modules";

export async function getUserSession(): Promise<UserSession | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: hubUser } = await supabase
    .from("hub_users")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!hubUser || !hubUser.active) return null;

  const { data: moduleRows } = await supabase
    .from("module_access")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true);

  return {
    hubUser: {
      id: hubUser.id,
      name: hubUser.name,
      email: hubUser.email,
      hub_role: hubUser.hub_role,
      auth_provider: hubUser.auth_provider,
      active: hubUser.active,
      last_login_at: hubUser.last_login_at,
      created_at: hubUser.created_at,
    },
    moduleAccess: (moduleRows || []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      module_id: r.module_id,
      module_role: r.module_role,
      config: r.config || {},
      active: r.active,
      granted_by: r.granted_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

export async function requireAuth(): Promise<UserSession> {
  const session = await getUserSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireHubAdmin(): Promise<UserSession> {
  const session = await requireAuth();
  if (session.hubUser.hub_role !== "hub_admin") redirect("/");
  return session;
}

export async function requireModuleAccess(
  moduleId: string
): Promise<{ session: UserSession; access: ModuleAccessRecord }> {
  const session = await requireAuth();

  if (session.hubUser.hub_role === "hub_admin") {
    const existing = session.moduleAccess.find(
      (m) => m.module_id === moduleId
    );
    const access: ModuleAccessRecord = existing || {
      id: "",
      user_id: session.hubUser.id,
      module_id: moduleId as ModuleAccessRecord["module_id"],
      module_role: "admin",
      config: {},
      active: true,
      granted_by: null,
      created_at: "",
      updated_at: "",
    };
    return { session, access };
  }

  const access = session.moduleAccess.find((m) => m.module_id === moduleId);
  if (!access) redirect("/");
  return { session, access };
}

export function resolveGrowerPortalContext(
  access: ModuleAccessRecord
): GrowerPortalContext {
  const config = access.config as Record<string, unknown>;
  return {
    moduleRole: access.module_role as "admin" | "staff" | "grower_admin" | "grower",
    growerId: (config.grower_id as string) || null,
    farmIds: (config.farm_ids as string[] | null) ?? null,
    allowedMenuItems: (config.allowed_menu_items as string[]) || [],
    financialAccess: (config.financial_access as Record<string, boolean>) || {},
    capabilities: (config.capabilities as string[]) || [],
  };
}
