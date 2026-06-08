/**
 * GET /api/hub-admin/freshtrack-catalogue?type=farm|recipient&search=...&excludeProvisioned=true
 *
 * Returns synced ft_entities the super admin can promote into farms or
 * rcti_recipients. Backed by the GraphQL sync (migration 00010 +
 * lib/freshtrack/sync/entitySync.ts).
 *
 * type=farm        -> classification IN ('farm','self_paid_farm')
 * type=recipient   -> classification IN ('rcti_recipient','self_paid_farm')
 *                    (a self-paid grower acts as both a farm and a recipient)
 *
 * excludeProvisioned defaults to true: hides catalogue rows already linked
 * into a farms/rcti_recipients row. Pass excludeProvisioned=false to show
 * everything.
 */
import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type CatalogueType = "farm" | "recipient";

interface CatalogueRow {
  freshtrack_id: string;
  code: string | null;
  name: string | null;
  classification: string | null;
  parent_freshtrack_id: string | null;
  parent_code: string | null;
  parent_name: string | null;
  farm_freshtrack_id: string | null;
  abn: string | null;
  is_provisioned: boolean;
}

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") as CatalogueType | null) ?? "farm";
  const search = searchParams.get("search")?.trim() ?? "";
  const excludeProvisioned =
    (searchParams.get("excludeProvisioned") ?? "true").toLowerCase() !== "false";

  const classifications =
    type === "recipient"
      ? ["rcti_recipient", "self_paid_farm"]
      : ["farm", "self_paid_farm"];

  const admin = createAdminClient();

  let query = admin
    .from("ft_entities")
    .select(
      "freshtrack_id, entity_code, entity_name, classification, parent_freshtrack_id, farm_freshtrack_id, abn, is_provisioned, org_legal_name"
    )
    .in("classification", classifications)
    .eq("active", true)
    .not("freshtrack_id", "is", null)
    .order("entity_name", { ascending: true })
    .limit(500);

  if (excludeProvisioned) query = query.eq("is_provisioned", false);
  if (search) {
    query = query.or(
      `entity_code.ilike.%${search}%,entity_name.ilike.%${search}%,org_legal_name.ilike.%${search}%`
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Second pass — look up parent rows for display ("LMBCO under LMB").
  const parentIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.parent_freshtrack_id as string | null)
        .filter((id): id is string => id !== null)
    )
  );
  const parentMap = new Map<string, { code: string | null; name: string | null }>();
  if (parentIds.length > 0) {
    const { data: parents } = await admin
      .from("ft_entities")
      .select("freshtrack_id, entity_code, entity_name")
      .in("freshtrack_id", parentIds);
    for (const p of parents ?? []) {
      parentMap.set(p.freshtrack_id as string, {
        code: p.entity_code as string | null,
        name: p.entity_name as string | null,
      });
    }
  }

  const result: CatalogueRow[] = (rows ?? []).map((r) => {
    const parent = r.parent_freshtrack_id
      ? parentMap.get(r.parent_freshtrack_id as string) ?? null
      : null;
    return {
      freshtrack_id: r.freshtrack_id as string,
      code: r.entity_code as string | null,
      name: (r.entity_name as string | null) ?? (r.org_legal_name as string | null),
      classification: r.classification as string | null,
      parent_freshtrack_id: r.parent_freshtrack_id as string | null,
      parent_code: parent?.code ?? null,
      parent_name: parent?.name ?? null,
      farm_freshtrack_id: r.farm_freshtrack_id as string | null,
      abn: r.abn as string | null,
      is_provisioned: (r.is_provisioned as boolean | null) ?? false,
    };
  });

  return NextResponse.json(result);
}
