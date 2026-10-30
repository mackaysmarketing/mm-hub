/**
 * GET — the live FreshTrack product catalogue for the rule form's product
 * picker (migration 00024). Read-only reference data, so any Tools-access
 * user can fetch it; saving a rule stays hub_admin only.
 */
import { NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { loadLiveProducts } from "@/lib/processes/consignorAssign/liveProducts";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await loadLiveProducts());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load products: ${message}` }, { status: 502 });
  }
}
