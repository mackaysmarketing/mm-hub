import { getUserSession } from "@/lib/auth";
import { ConsignorAutoAssignClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Server wrapper so the client page can gate mutation controls (rule
 * CRUD, mode/schedule changes, Run now, Unassign) without a separate
 * client-side round trip just to learn the caller's role. Reads (the
 * Overview/Activity data itself) are open to anyone with Tools menu access —
 * enforced again, authoritatively, at the API layer regardless of what this
 * prop says.
 */
export default async function ConsignorAutoAssignPage() {
  const session = await getUserSession();
  const isHubAdmin = session?.hubUser.hub_role === "hub_admin";
  return <ConsignorAutoAssignClient isHubAdmin={isHubAdmin} />;
}
