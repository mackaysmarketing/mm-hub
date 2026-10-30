/**
 * PATCH — edit a rule. DELETE — remove a rule. Both hub_admin only.
 *
 * PATCH merges the request over the stored rule and re-runs the same checks
 * as create (buildRuleRows), so an edit can never store a combination create
 * would refuse — e.g. switching a rule to "leave blank" clears its consignor
 * in the same write. `enabled` may also be patched on its own.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRuleRows, type RuleInput } from "@/lib/processes/consignorAssign/ruleInput";
import { loadLiveProducts } from "@/lib/processes/consignorAssign/liveProducts";
import { ruleWriteErrorResponse } from "../ruleWriteErrors";

export const dynamic = "force-dynamic";

const RULE_FIELDS = [
  "consignee_entity_code",
  "consignee_freshtrack_id",
  "crop_id",
  "crop_name",
  "product_code",
  "action",
  "consignor_entity_code",
  "consignor_freshtrack_id",
  "notes",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const touchesRule = RULE_FIELDS.some((f) => f in body);
  const hasEnabled = "enabled" in body;
  if (!touchesRule && !hasEnabled) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  if (hasEnabled && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "'enabled' must be true or false" }, { status: 400 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (hasEnabled) patch.enabled = body.enabled;

  if (touchesRule) {
    const { data: current, error: readError } = await admin
      .from("consignor_assignment_rules")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const merged: RuleInput = {
      consignee_entity_code: current.consignee_entity_code,
      consignee_freshtrack_id: current.consignee_freshtrack_id,
      crop_id: current.crop_id,
      crop_name: current.crop_name,
      product_code: current.product_code,
      action: current.action,
      consignor_entity_code: current.consignor_entity_code,
      consignor_freshtrack_id: current.consignor_freshtrack_id,
      notes: current.notes,
    };
    for (const f of RULE_FIELDS) {
      if (f in body) (merged as Record<string, unknown>)[f] = body[f];
    }
    // An edit is one rule: a list of products belongs to create only.
    if ("product_codes" in body) {
      return NextResponse.json({ error: "Edit one product at a time — use product_code." }, { status: 400 });
    }

    let products: Awaited<ReturnType<typeof loadLiveProducts>> = [];
    if (typeof merged.product_code === "string" && merged.product_code.trim()) {
      try {
        products = await loadLiveProducts();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Couldn't check the product against FreshTrack: ${message}` }, { status: 502 });
      }
    }

    const built = buildRuleRows(merged, products);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    Object.assign(patch, built.rows[0]);
  }

  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return ruleWriteErrorResponse(error);
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin.from("consignor_assignment_rules").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
