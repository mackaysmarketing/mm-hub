/**
 * Per-tool access checks.
 *
 * The rule, in one place so no route can drift from it:
 *   hub_admin                      → always allowed, and may grant to others
 *   holds a tool_access row        → allowed
 *   internal (admin/staff) + tool  → allowed only if the tool is not gated
 *     is not gated
 *   anyone else                    → denied
 *
 * Grower-side users never reach Tools at all: the Tools menu item is not in
 * their default menu items and hasMenuAccess() already refuses the page. This
 * module is the second, tool-level gate on top of that.
 */
import "server-only";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalAccessContext } from "@/lib/portal-access";
import { getTool, TOOLS, type ToolDefinition } from "./registry";
import type { UserSession } from "@/types/modules";

export interface ToolAccessDecision {
  allowed: boolean;
  isHubAdmin: boolean;
  session: UserSession | null;
  reason?: string;
}

export async function checkToolAccess(toolKey: string): Promise<ToolAccessDecision> {
  const session = await getUserSession();
  if (!session) return { allowed: false, isHubAdmin: false, session: null, reason: "not signed in" };

  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (isHubAdmin) return { allowed: true, isHubAdmin: true, session };

  // Tools is an internal-only section; confirm that before looking at grants.
  const context = await getPortalAccessContext();
  if (!context.isInternal) {
    return {
      allowed: false,
      isHubAdmin: false,
      session,
      reason: "Tools is available to Mackays internal users only",
    };
  }

  const tool = getTool(toolKey);
  if (!tool) {
    return { allowed: false, isHubAdmin: false, session, reason: `unknown tool "${toolKey}"` };
  }
  if (!tool.gated) return { allowed: true, isHubAdmin: false, session };

  const admin = createAdminClient();
  const { data } = await admin
    .from("tool_access")
    .select("id")
    .eq("tool_key", toolKey)
    .eq("user_id", session.hubUser.id)
    .maybeSingle();

  return data
    ? { allowed: true, isHubAdmin: false, session }
    : {
        allowed: false,
        isHubAdmin: false,
        session,
        reason: "you have not been given access to this tool",
      };
}

/** The tools the current user may see, for the Tools index page. */
export async function listVisibleTools(): Promise<ToolDefinition[]> {
  const session = await getUserSession();
  if (!session) return [];

  if (session.hubUser.hub_role === "hub_admin") return TOOLS;

  const context = await getPortalAccessContext();
  if (!context.isInternal) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("tool_access")
    .select("tool_key")
    .eq("user_id", session.hubUser.id);
  const granted = new Set((data ?? []).map((r) => r.tool_key as string));

  return TOOLS.filter((t) => !t.gated || granted.has(t.key));
}

/**
 * Users who could plausibly be given a tool — Mackays-internal accounts only.
 * A grower-side account is never offered, because granting one a tool would
 * still be refused at the page and would only mislead whoever granted it.
 */
export interface GrantableUser {
  id: string;
  name: string;
  email: string;
  hubRole: string;
  moduleRole: string | null;
  /** hub_admins always have access and cannot be revoked. */
  alwaysAllowed: boolean;
  hasAccess: boolean;
  grantedAt: string | null;
}

export async function listGrantableUsers(toolKey: string): Promise<GrantableUser[]> {
  const admin = createAdminClient();

  const [{ data: users }, { data: moduleRows }, { data: grants }] = await Promise.all([
    admin
      .from("hub_users")
      .select("id, name, email, hub_role, active")
      .eq("active", true)
      .order("name"),
    admin
      .from("module_access")
      .select("user_id, module_role")
      .eq("module_id", "grower-portal")
      .eq("active", true),
    admin.from("tool_access").select("user_id, created_at").eq("tool_key", toolKey),
  ]);

  const roleByUser = new Map(
    (moduleRows ?? []).map((r) => [r.user_id as string, r.module_role as string])
  );
  const grantByUser = new Map(
    (grants ?? []).map((g) => [g.user_id as string, g.created_at as string])
  );

  return (users ?? [])
    .map((u) => {
      const hubRole = u.hub_role as string;
      const moduleRole = roleByUser.get(u.id as string) ?? null;
      const isInternal =
        hubRole === "hub_admin" || moduleRole === "admin" || moduleRole === "staff";
      if (!isInternal) return null;

      const alwaysAllowed = hubRole === "hub_admin";
      return {
        id: u.id as string,
        name: (u.name as string) ?? "",
        email: (u.email as string) ?? "",
        hubRole,
        moduleRole,
        alwaysAllowed,
        hasAccess: alwaysAllowed || grantByUser.has(u.id as string),
        grantedAt: grantByUser.get(u.id as string) ?? null,
      } satisfies GrantableUser;
    })
    .filter((u): u is GrantableUser => u !== null);
}
