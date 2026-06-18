import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter, hasMenuAccess } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

const TIME_RANGE_DAYS: Record<string, number> = {
  "4W": 28,
  "12W": 84,
  "26W": 182,
  "52W": 364,
};

interface HarvestRow {
  id: string;
  grower_id: string | null;
  docket_no: string | null;
  crop_name: string | null;
  variety_name: string | null;
  planting_description: string | null;
  block_name: string | null;
  state_name: string | null;
  harvested_on: string | null;
  received_on: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const timeRange = searchParams.get("timeRange") ?? "26W";
  const search = searchParams.get("search");

  const days = TIME_RANGE_DAYS[timeRange] ?? 182;
  const periodStart = new Date(Date.now() - days * 86400000);

  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("ft_harvest_loads")
    .select(
      "id, grower_id, docket_no, crop_name, variety_name, planting_description, block_name, state_name, harvested_on, received_on"
    )
    .gte("harvested_on", periodStart.toISOString())
    .order("harvested_on", { ascending: false })
    .limit(300);

  if (growerFilter) query = query.in("grower_id", growerFilter);
  if (search?.trim()) {
    const s = search.trim();
    query = query.or(
      `docket_no.ilike.%${s}%,crop_name.ilike.%${s}%,variety_name.ilike.%${s}%,block_name.ilike.%${s}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as HarvestRow[];

  // Resolve farm names for display (grower_id -> farms.name/code), RLS-scoped.
  const farmIds = Array.from(
    new Set(rows.map((r) => r.grower_id).filter(Boolean))
  ) as string[];
  const farmMap = new Map<string, { name: string | null; code: string | null }>();
  if (farmIds.length > 0) {
    const { data: farms } = await supabase
      .from("farms")
      .select("id, name, code")
      .in("id", farmIds);
    for (const f of farms ?? []) {
      farmMap.set(f.id as string, { name: f.name as string | null, code: f.code as string | null });
    }
  }

  const result = rows.map((r) => ({
    ...r,
    farm_name: r.grower_id ? farmMap.get(r.grower_id)?.name ?? null : null,
    farm_code: r.grower_id ? farmMap.get(r.grower_id)?.code ?? null : null,
  }));

  return NextResponse.json(result);
}
