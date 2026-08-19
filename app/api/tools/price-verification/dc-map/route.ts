/**
 * GET   — the retailer DC → FreshTrack consignee mapping, plus the consignee
 *         entities available to map to.
 * PATCH — change one mapping (hub_admin only).
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { loadDcMappings, updateDcMapping } from "@/lib/priceVerification/settings";
import { TOOL_KEY, type Retailer } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [mappings, { data: entities }] = await Promise.all([
    loadDcMappings(),
    admin
      .from("ft_entities")
      .select("entity_code, entity_name")
      .not("consignee_freshtrack_id", "is", null)
      .eq("is_consignee_active", true)
      .order("entity_code"),
  ]);

  return NextResponse.json({
    mappings,
    entities: (entities ?? []).map((e) => ({
      code: e.entity_code as string,
      name: e.entity_name as string,
    })),
  });
}

export async function PATCH(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }
  if (!access.isHubAdmin) {
    return NextResponse.json(
      { error: "Only a hub admin can change the DC mapping" },
      { status: 403 }
    );
  }

  let body: {
    retailer?: Retailer;
    dcCode?: string;
    entityCode?: string | null;
    dcLabel?: string | null;
    active?: boolean;
    notes?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.retailer || !body.dcCode) {
    return NextResponse.json(
      { error: "retailer and dcCode are required" },
      { status: 400 }
    );
  }

  // A typo'd entity code would silently map a DC to nothing and its orders
  // would report as unmapped with no clue why, so it is checked here.
  if (body.entityCode) {
    const admin = createAdminClient();
    const { data: entity } = await admin
      .from("ft_entities")
      .select("entity_code")
      .eq("entity_code", body.entityCode)
      .not("consignee_freshtrack_id", "is", null)
      .maybeSingle();
    if (!entity) {
      return NextResponse.json(
        {
          error:
            `"${body.entityCode}" is not a FreshTrack entity with a consignee ` +
            `association, so no order could ever match it.`,
        },
        { status: 400 }
      );
    }
  }

  try {
    await updateDcMapping(body.retailer, body.dcCode, {
      entityCode: body.entityCode,
      dcLabel: body.dcLabel,
      active: body.active,
      notes: body.notes,
    });
    return NextResponse.json({ mappings: await loadDcMappings() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
