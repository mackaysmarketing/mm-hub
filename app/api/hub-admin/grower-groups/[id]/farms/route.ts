import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — list farms (growers rows) in this group, with recipient assignment.
 * POST — create a new farm IN this group; optionally assigned to an RCTI recipient.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("farms")
    .select(
      "id, name, code, freshtrack_code, abn, active, rcti_recipient_id, rcti_recipients(name)"
    )
    .eq("grower_group_id", groupId)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Confirm the group exists (avoid silently inserting under a bad group id).
  const { data: group } = await admin
    .from("grower_groups")
    .select("id")
    .eq("id", groupId)
    .single();
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Common: validate the optional recipient assignment belongs to this group
  // (closes IDOR at the provisioning layer).
  const recipientId = (body.rcti_recipient_id as string | undefined)?.trim() || null;
  if (recipientId) {
    const { data: r } = await admin
      .from("rcti_recipients")
      .select("id, grower_group_id")
      .eq("id", recipientId)
      .single();
    if (!r || r.grower_group_id !== groupId) {
      return NextResponse.json(
        { error: "Recipient does not belong to this group" },
        { status: 400 }
      );
    }
  }

  // Two modes, distinguished by whether the caller picked from the FT catalogue:
  //
  //   freshtrack_entity_uuid present -> CATALOGUE mode: look up ft_entities,
  //     pre-fill name/code/freshtrack_code/abn from the synced row, mark the
  //     catalogue entry as is_provisioned=true so it doesn't appear in the
  //     "unprovisioned" picker again. Caller can still override name etc.
  //
  //   Otherwise -> MANUAL mode: existing behaviour, name+code required.
  //
  const catalogueEntityUuid =
    (body.freshtrack_entity_uuid as string | undefined)?.trim() || null;

  let name = (body.name as string | undefined)?.trim() ?? null;
  let code = (body.code as string | undefined)?.trim() ?? null;
  let freshtrackCode = (body.freshtrack_code as string | undefined)?.trim() ?? null;
  let abn = (body.abn as string | undefined)?.trim() ?? null;
  let farmFreshtrackUuid: string | null = null;

  if (catalogueEntityUuid) {
    const { data: cat, error: catErr } = await admin
      .from("ft_entities")
      .select(
        "freshtrack_id, entity_code, entity_name, abn, farm_freshtrack_id, org_legal_name, classification"
      )
      .eq("freshtrack_id", catalogueEntityUuid)
      .maybeSingle();
    if (catErr || !cat) {
      return NextResponse.json(
        { error: "FreshTrack catalogue entry not found — has the sync run?" },
        { status: 404 }
      );
    }
    const cls = cat.classification as string | null;
    if (cls !== "farm" && cls !== "self_paid_farm") {
      return NextResponse.json(
        {
          error: `Catalogue entry is classified '${cls}' — only 'farm' or 'self_paid_farm' can be promoted to a farm row.`,
        },
        { status: 400 }
      );
    }
    name = name ?? ((cat.entity_name as string | null) ?? (cat.org_legal_name as string | null));
    code = code ?? (cat.entity_code as string | null);
    freshtrackCode = freshtrackCode ?? (cat.entity_code as string | null);
    abn = abn ?? (cat.abn as string | null);
    farmFreshtrackUuid = (cat.farm_freshtrack_id as string | null) ?? null;
  }

  if (!name || !code) {
    return NextResponse.json(
      { error: "name and code are required" },
      { status: 400 }
    );
  }

  const insertPayload: Record<string, unknown> = {
    grower_group_id: groupId,
    name,
    code,
    freshtrack_code: freshtrackCode,
    abn,
    address: (body.address as string | undefined)?.trim() || null,
    email: (body.email as string | undefined)?.trim() || null,
    phone: (body.phone as string | undefined)?.trim() || null,
    rcti_recipient_id: recipientId,
  };
  if (catalogueEntityUuid) {
    insertPayload.freshtrack_entity_uuid = catalogueEntityUuid;
    if (farmFreshtrackUuid) insertPayload.freshtrack_farm_uuid = farmFreshtrackUuid;
  }

  const { data, error } = await admin
    .from("farms")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mark the catalogue entry as provisioned so it doesn't reappear in the
  // unprovisioned picker. Non-fatal if this fails — re-promoting is a
  // 400 from the uniqueness on farms.freshtrack_entity_uuid (idx in 00010).
  if (catalogueEntityUuid) {
    await admin
      .from("ft_entities")
      .update({ is_provisioned: true })
      .eq("freshtrack_id", catalogueEntityUuid);
  }

  return NextResponse.json(data, { status: 201 });
}
