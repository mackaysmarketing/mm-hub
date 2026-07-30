/**
 * PATCH — edit a rule. DELETE — remove a rule. Both hub_admin only.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "consignee_entity_code",
  "consignee_freshtrack_id",
  "crop_id",
  "crop_name",
  "consignor_entity_code",
  "consignor_freshtrack_id",
  "enabled",
  "notes",
] as const;

// These columns are nullable and mean something specific when null (e.g.
// consignee null = "any customer"). The UI form sends "" for a cleared
// field, not null — coerce so an edit can't silently write an empty STRING
// into a column whose semantics depend on true NULL.
const NULLABLE_ON_BLANK = new Set([
  "consignee_entity_code",
  "consignee_freshtrack_id",
  "crop_id",
  "crop_name",
  "notes",
]);

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

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    patch[field] =
      NULLABLE_ON_BLANK.has(field) && typeof value === "string" && value.trim() === ""
        ? null
        : value;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { id } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consignor_assignment_rules")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "An active rule already exists for this customer + crop combination.",
        },
        { status: 409 }
      );
    }
    // consignor_rules_not_fully_wildcard — e.g. clearing consignee on a rule
    // that has no crop set either, which would match every order.
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "A rule needs a customer, a crop, or both." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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
