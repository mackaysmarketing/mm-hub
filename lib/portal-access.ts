import { createClient } from "@/lib/supabase/server";

/**
 * Extracts farm_ids and financial_access from the current user's session.
 * Used by API routes to apply farm-level filtering and financial access control.
 */
export interface PortalAccessContext {
  growerId: string | null;
  farmIds: string[] | null;      // null = all farms
  financialAccess: Record<string, boolean>;
  moduleRole: string;
  capabilities: string[];
}

export async function getPortalAccessContext(): Promise<PortalAccessContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      growerId: null,
      farmIds: null,
      financialAccess: {},
      moduleRole: "",
      capabilities: [],
    };
  }

  const { data: access } = await supabase
    .from("module_access")
    .select("module_role, config")
    .eq("user_id", user.id)
    .eq("module_id", "grower-portal")
    .eq("active", true)
    .single();

  if (!access) {
    // Check if hub_admin — they get full access
    const { data: hubUser } = await supabase
      .from("hub_users")
      .select("hub_role")
      .eq("id", user.id)
      .single();

    if (hubUser?.hub_role === "hub_admin") {
      return {
        growerId: null,
        farmIds: null,
        financialAccess: {},
        moduleRole: "admin",
        capabilities: ["manage_users", "view_all_growers", "enter_qa", "trigger_sync"],
      };
    }

    return {
      growerId: null,
      farmIds: null,
      financialAccess: {},
      moduleRole: "",
      capabilities: [],
    };
  }

  const config = access.config as Record<string, unknown>;

  return {
    growerId: (config.grower_id as string) || null,
    farmIds: (config.farm_ids as string[] | null) ?? null,
    financialAccess: (config.financial_access as Record<string, boolean>) || {},
    moduleRole: access.module_role,
    capabilities: (config.capabilities as string[]) || [],
  };
}

/**
 * Builds a Supabase query filter for farm_id based on the user's access.
 * Returns the farmIds to filter by, or null if no filtering needed.
 */
export function getFarmFilter(
  context: PortalAccessContext,
  requestFarmId?: string | null
): string[] | null {
  // If a specific farm is requested (from farm selector), use that
  if (requestFarmId) {
    // Validate the user can access this farm
    if (context.farmIds && !context.farmIds.includes(requestFarmId)) {
      return []; // Empty array = no access
    }
    return [requestFarmId];
  }

  // Otherwise, use the user's assigned farm_ids (null = all farms)
  return context.farmIds;
}
