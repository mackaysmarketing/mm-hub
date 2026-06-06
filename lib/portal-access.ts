import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the current user's grower-portal access scope across BOTH axes:
 *   - farm (production) scope    -> growerIds
 *   - RCTI recipient (financial) -> recipientIds
 * Used by API routes for defense-in-depth filtering on top of RLS (which is the
 * authoritative boundary — see migration 00005).
 *
 * For grower-side users (grower / grower_admin) the "all in group" case is
 * resolved to a CONCRETE id list, so the app-layer filters are a real boundary
 * and never trust an unvalidated client-supplied id. Internal users
 * (admin / staff / hub_admin) keep null = "all tenants".
 */
export interface PortalAccessContext {
  growerGroupId: string | null;
  growerIds: string[] | null; // null = all (internal users only)
  recipientIds: string[] | null; // null = all (internal users only)
  isInternal: boolean; // Mackays-internal user — sees all tenants
  allowedMenuItems: string[] | null; // null = all (internal users); else the granted menu items
  financialAccess: Record<string, boolean>;
  moduleRole: string;
  capabilities: string[];
}

const EMPTY_CONTEXT: PortalAccessContext = {
  growerGroupId: null,
  growerIds: [],
  recipientIds: [],
  isInternal: false,
  allowedMenuItems: [],
  financialAccess: {},
  moduleRole: "",
  capabilities: [],
};

export async function getPortalAccessContext(): Promise<PortalAccessContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return EMPTY_CONTEXT;

  const { data: access } = await supabase
    .from("module_access")
    .select("module_role, config")
    .eq("user_id", user.id)
    .eq("module_id", "grower-portal")
    .eq("active", true)
    .single();

  if (!access) {
    // hub_admin gets full internal access without an explicit module_access row.
    const { data: hubUser } = await supabase
      .from("hub_users")
      .select("hub_role")
      .eq("id", user.id)
      .single();

    if (hubUser?.hub_role === "hub_admin") {
      return {
        growerGroupId: null,
        growerIds: null,
        recipientIds: null,
        isInternal: true,
        allowedMenuItems: null,
        financialAccess: {},
        moduleRole: "admin",
        capabilities: ["manage_users", "view_all_growers", "enter_qa", "trigger_sync"],
      };
    }

    return EMPTY_CONTEXT;
  }

  const config = access.config as Record<string, unknown>;
  const moduleRole = access.module_role;
  const groupId = (config.grower_group_id as string) || null;
  const isInternal = moduleRole === "admin" || moduleRole === "staff";

  const configGrowerIds = (config.grower_ids as string[] | null) ?? null;
  const configRecipientIds = (config.recipient_ids as string[] | null) ?? null;

  let growerIds: string[] | null;
  let recipientIds: string[] | null;

  if (isInternal) {
    // Cross-tenant; RLS grants all. No app-layer narrowing.
    growerIds = null;
    recipientIds = null;
  } else {
    // Grower-side: resolve "all in group" (null) to the concrete id list so the
    // app filter is a genuine boundary, not a trusted-client passthrough.
    growerIds = configGrowerIds ?? (await resolveGroupIds(supabase, "growers", groupId));
    recipientIds =
      configRecipientIds ?? (await resolveGroupIds(supabase, "rcti_recipients", groupId));
  }

  return {
    growerGroupId: groupId,
    growerIds,
    recipientIds,
    isInternal,
    allowedMenuItems: isInternal
      ? null
      : (config.allowed_menu_items as string[] | null) ?? [],
    financialAccess: (config.financial_access as Record<string, boolean>) || {},
    moduleRole,
    capabilities: (config.capabilities as string[]) || [],
  };
}

/**
 * Menu-item (page) authorization — the second scoping dimension. Internal users
 * (allowedMenuItems === null) may access everything; grower-side users may only
 * access pages explicitly granted in their config. Routes call this to 403 a
 * page the caller was not granted, so menu permissions are enforced server-side
 * rather than merely hidden in the sidebar.
 */
export function hasMenuAccess(
  context: PortalAccessContext,
  menuItem: string
): boolean {
  if (context.allowedMenuItems === null) return true; // internal — all pages
  return context.allowedMenuItems.includes(menuItem);
}

async function resolveGroupIds(
  supabase: ReturnType<typeof createClient>,
  table: "growers" | "rcti_recipients",
  groupId: string | null
): Promise<string[]> {
  if (!groupId) return [];
  const { data } = await supabase.from(table).select("id").eq("grower_group_id", groupId);
  return (data ?? []).map((row) => (row as { id: string }).id);
}

/**
 * Farm-axis filter. Returns the grower(=farm) ids to constrain a query by, or
 * null when no app-layer narrowing is needed (internal users; RLS covers them).
 * A requested id is only honored if it is within the caller's resolved scope —
 * a foreign id returns [] (no access), closing the previous IDOR.
 */
export function getGrowerFilter(
  context: PortalAccessContext,
  requestGrowerId?: string | null
): string[] | null {
  if (requestGrowerId) {
    if (context.isInternal) return [requestGrowerId];
    if (context.growerIds && context.growerIds.includes(requestGrowerId)) {
      return [requestGrowerId];
    }
    return []; // requested a farm outside the caller's scope → no access
  }
  return context.growerIds;
}

/**
 * RCTI-recipient (financial) axis filter — same contract as getGrowerFilter but
 * for the payment grain (remittances). A foreign recipient id returns [].
 */
export function getRecipientFilter(
  context: PortalAccessContext,
  requestRecipientId?: string | null
): string[] | null {
  if (requestRecipientId) {
    if (context.isInternal) return [requestRecipientId];
    if (context.recipientIds && context.recipientIds.includes(requestRecipientId)) {
      return [requestRecipientId];
    }
    return [];
  }
  return context.recipientIds;
}
