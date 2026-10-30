/**
 * GET — list mapping rules (any Tools-access user).
 * POST — create rules (hub_admin only). No effective-date fields — see design
 * doc §5 "what is gone".
 *
 * Migration 00024: a POST may name several products (`product_codes`) and
 * makes one rule per product, in one insert — all or nothing. Every check
 * lives in buildRuleRows, shared with PATCH.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRuleRows, type RuleInput } from "@/lib/processes/consignorAssign/ruleInput";
import { loadLiveProducts } from "@/lib/processes/consignorAssign/liveProducts";
import { ruleWriteErrorResponse } from "./ruleWriteErrors";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Tools")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .select("*")
    // Global (any-customer) rules first — a small set with outsized reach,
    // worth surfacing rather than burying alphabetically.
    .order("consignee_entity_code", { nullsFirst: true })
    .order("crop_name", { nullsFirst: true })
    .order("product_code", { nullsFirst: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: RuleInput;
  try {
    body = (await request.json()) as RuleInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only load the catalogue when products were actually chosen.
  const wantsProducts =
    (Array.isArray(body.product_codes) && body.product_codes.some((c) => typeof c === "string" && c.trim())) ||
    (typeof body.product_code === "string" && body.product_code.trim().length > 0);
  let products: Awaited<ReturnType<typeof loadLiveProducts>> = [];
  if (wantsProducts) {
    try {
      products = await loadLiveProducts();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Couldn't check the products against FreshTrack: ${message}` }, { status: 502 });
    }
  }

  const built = buildRuleRows(body, products);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .insert(built.rows.map((row) => ({ ...row, created_by: session.hubUser.id })))
    .select();

  if (error) return ruleWriteErrorResponse(error);
  return NextResponse.json(data, { status: 201 });
}
