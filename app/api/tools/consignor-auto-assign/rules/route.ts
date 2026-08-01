/**
 * GET — list mapping rules (any Tools-access user).
 * POST — create a rule (hub_admin only), matching the grower-groups CRUD
 * pattern. No effective-date fields — see design doc §5 "what is gone".
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { getPortalAccessContext, hasMenuAccess } from "@/lib/portal-access";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .order("crop_name", { nullsFirst: true });

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    consignee_entity_code,
    consignee_freshtrack_id,
    crop_id,
    crop_name,
    consignor_entity_code,
    consignor_freshtrack_id,
    notes,
  } = body as {
    consignee_entity_code?: string | null;
    consignee_freshtrack_id?: string | null;
    crop_id?: string | null;
    crop_name?: string | null;
    consignor_entity_code?: string;
    consignor_freshtrack_id?: string;
    notes?: string;
  };

  if (!consignor_entity_code || !consignor_freshtrack_id) {
    return NextResponse.json(
      { error: "Missing required fields: consignor_entity_code, consignor_freshtrack_id" },
      { status: 400 }
    );
  }

  // Consignee is optional (migration 00018 — a blank consignee means "any
  // customer", e.g. "all Passionfruit routes via SQBR"), but code and id
  // must be given together, and a rule with NEITHER a consignee NOR a crop
  // would match literally everything — the DB blocks this too
  // (consignor_rules_not_fully_wildcard), but a friendly 400 beats a raw
  // constraint-violation message.
  const hasConsigneeCode = Boolean(consignee_entity_code?.trim());
  const hasConsigneeId = Boolean(consignee_freshtrack_id?.trim());
  if (hasConsigneeCode !== hasConsigneeId) {
    return NextResponse.json(
      {
        error:
          "consignee_entity_code and consignee_freshtrack_id must be given together, or both left blank for an any-customer rule",
      },
      { status: 400 }
    );
  }
  if (!hasConsigneeCode && !crop_id) {
    return NextResponse.json(
      {
        error:
          "A rule needs a customer, a crop, or both — leaving both blank would match every order",
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .insert({
      consignee_entity_code: consignee_entity_code || null,
      consignee_freshtrack_id: consignee_freshtrack_id || null,
      crop_id: crop_id || null,
      crop_name: crop_name || null,
      consignor_entity_code,
      consignor_freshtrack_id,
      notes: notes || null,
      created_by: session.hubUser.id,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation on consignor_rules_uniq: an active rule
    // already covers this (consignee, crop) pair.
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "An active rule already exists for this customer + crop combination. Edit or disable it first.",
        },
        { status: 409 }
      );
    }
    // 23514 = check_violation — defense in depth if the client-side check
    // above is ever bypassed (consignor_rules_not_fully_wildcard).
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "A rule needs a customer, a crop, or both." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
