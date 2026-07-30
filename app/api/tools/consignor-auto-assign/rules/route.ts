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
    .order("consignee_entity_code")
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
    consignee_entity_code?: string;
    consignee_freshtrack_id?: string;
    crop_id?: string | null;
    crop_name?: string | null;
    consignor_entity_code?: string;
    consignor_freshtrack_id?: string;
    notes?: string;
  };

  if (
    !consignee_entity_code ||
    !consignee_freshtrack_id ||
    !consignor_entity_code ||
    !consignor_freshtrack_id
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: consignee_entity_code, consignee_freshtrack_id, consignor_entity_code, consignor_freshtrack_id",
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .insert({
      consignee_entity_code,
      consignee_freshtrack_id,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
