/**
 * GET — the live FreshTrack order-state catalogue (code, name, sequence),
 * used to render the "Assignable states" editor on the Schedule & run tab.
 * Read-only reference data, so any Tools-access user can fetch it — the
 * PATCH that actually changes assignable_state_codes stays hub_admin only,
 * enforced by app/api/tools/consignor-auto-assign/settings/route.ts.
 */
import { NextResponse } from "next/server";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import { Q_ORDER_STATES, type RspOrderStates } from "@/lib/freshtrack/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const res = await gqlQuery<RspOrderStates>(Q_ORDER_STATES);
    const states = [...res.orderStates].sort((a, b) => a.sequence - b.sequence);
    return NextResponse.json(states);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load order states: ${message}` }, { status: 502 });
  }
}
