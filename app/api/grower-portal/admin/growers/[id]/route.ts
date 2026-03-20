import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getCapabilities(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string[] {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return [];
  return (access.config as Record<string, unknown>).capabilities as string[] ?? [];
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("view_all_growers")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [growerResult, consignmentCount, latestRemittance, latestQA] =
    await Promise.all([
      admin.from("growers").select("*").eq("id", params.id).single(),
      admin
        .from("ft_consignments")
        .select("id", { count: "exact", head: true })
        .eq("grower_id", params.id),
      admin
        .from("remittances")
        .select("remittance_date")
        .eq("grower_id", params.id)
        .order("remittance_date", { ascending: false })
        .limit(1),
      admin
        .from("qa_assessments")
        .select("overall_score, status, assessment_date")
        .eq("grower_id", params.id)
        .order("assessment_date", { ascending: false })
        .limit(1),
    ]);

  if (growerResult.error) {
    return NextResponse.json({ error: "Grower not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...growerResult.data,
    stats: {
      consignment_count: consignmentCount.count ?? 0,
      latest_remittance_date: latestRemittance.data?.[0]?.remittance_date ?? null,
      latest_qa: latestQA.data?.[0] ?? null,
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("manage_users")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, code, freshtrack_code, abn, address, email, phone, active } =
    body as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (code !== undefined) updates.code = code;
  if (freshtrack_code !== undefined) updates.freshtrack_code = freshtrack_code;
  if (abn !== undefined) updates.abn = abn;
  if (address !== undefined) updates.address = address;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (active !== undefined) updates.active = active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("growers")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
