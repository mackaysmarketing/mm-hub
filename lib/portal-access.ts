import { createClient } from "@/lib/supabase/server";

/**
 * Extracts grower_group_id, grower_ids, and financial_access from the current user's session.
 * Used by API routes to apply grower-level filtering and financial access control.
 */
export interface PortalAccessContext {
  growerGroupId: string | null;
  growerIds: string[] | null;     // null = all growers in group
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
      growerGroupId: null,
      growerIds: null,
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
        growerGroupId: null,
        growerIds: null,
        financialAccess: {},
        moduleRole: "admin",
        capabilities: ["manage_users", "view_all_growers", "enter_qa", "trigger_sync"],
      };
    }

    return {
      growerGroupId: null,
      growerIds: null,
      financialAccess: {},
      moduleRole: "",
      capabilities: [],
    };
  }

  const config = access.config as Record<string, unknown>;

  return {
    growerGroupId: (config.grower_group_id as string) || null,
    growerIds: (config.grower_ids as string[] | null) ?? null,
    financialAccess: (config.financial_access as Record<string, boolean>) || {},
    moduleRole: access.module_role,
    capabilities: (config.capabilities as string[]) || [],
  };
}

/**
 * Builds a grower_id filter based on the user's access.
 * Returns the growerIds to filter by, or null if no filtering needed.
 *
 * When growerIds is null (all growers in group): caller should filter by grower_group_id
 * via growers table join.
 * When growerIds has values: filter by grower_id IN (growerIds).
 */
export function getGrowerFilter(
  context: PortalAccessContext,
  requestGrowerId?: string | null
): string[] | null {
  // If a specific grower is requested (from grower switcher), use that
  if (requestGrowerId) {
    // Validate the user can access this grower
    if (context.growerIds && !context.growerIds.includes(requestGrowerId)) {
      return []; // Empty array = no access
    }
    return [requestGrowerId];
  }

  // Otherwise, use the user's assigned grower_ids (null = all growers in group)
  return context.growerIds;
}
