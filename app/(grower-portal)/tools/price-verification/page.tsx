import { redirect } from "next/navigation";
import { checkToolAccess } from "@/lib/tools/access";
import { TOOL_KEY } from "@/lib/priceVerification/types";
import { PriceVerificationClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Server gate. This tool is access-listed, so an ungranted user is bounced
 * here rather than being shown a shell that 403s on every panel. The API
 * routes re-check independently — this is the friendly door, not the lock.
 */
export default async function PriceVerificationPage() {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) redirect("/tools");

  return <PriceVerificationClient isHubAdmin={access.isHubAdmin} />;
}
