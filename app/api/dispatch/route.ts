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

interface DispatchRaw {
  id: string;
  load_number: string | null;
  order_no: string | null;
  po_no: string | null;
  pack_date: string | null;
  actual_pickup_on: string | null;
  actual_delivery_on: string | null;
  stock_boxes: number | null;
  is_complete: boolean | null;
  consignor_ft_id: string | null;
  consignee_ft_id: string | null;
  carrier_ft_id: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");
  const timeRange = searchParams.get("timeRange") ?? "26W";
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const days = TIME_RANGE_DAYS[timeRange] ?? 182;
  const periodStart = new Date(Date.now() - days * 86400000);

  const accessCtx = await getPortalAccessContext();
  if (!hasMenuAccess(accessCtx, "Dispatch")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const growerFilter = getGrowerFilter(accessCtx, growerId);

  const supabase = createClient();

  let query = supabase
    .from("ft_dispatch")
    .select(
      "id, load_number, order_no, po_no, pack_date, actual_pickup_on, actual_delivery_on, stock_boxes, is_complete, consignor_ft_id, consignee_ft_id, carrier_ft_id"
    )
    .gte("actual_pickup_on", periodStart.toISOString())
    .order("actual_pickup_on", { ascending: false })
    .limit(300);

  if (growerFilter) query = query.in("grower_id", growerFilter);
  if (status === "complete") query = query.eq("is_complete", true);
  if (status === "pending") query = query.eq("is_complete", false);
  if (search?.trim()) {
    const s = search.trim();
    query = query.or(
      `load_number.ilike.%${s}%,order_no.ilike.%${s}%,po_no.ilike.%${s}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as DispatchRaw[];

  // Resolve consignor / consignee / carrier role-ids -> entity display names.
  const { data: ents } = await supabase
    .from("ft_entities")
    .select(
      "entity_name, entity_code, consignor_freshtrack_id, consignee_freshtrack_id, carrier_freshtrack_id"
    );
  const consignorName = new Map<string, string>();
  const consigneeName = new Map<string, string>();
  const carrierName = new Map<string, string>();
  for (const e of ents ?? []) {
    const label = (e.entity_name as string) || (e.entity_code as string) || "";
    if (e.consignor_freshtrack_id) consignorName.set(e.consignor_freshtrack_id as string, label);
    if (e.consignee_freshtrack_id) consigneeName.set(e.consignee_freshtrack_id as string, label);
    if (e.carrier_freshtrack_id) carrierName.set(e.carrier_freshtrack_id as string, label);
  }

  const result = rows.map((d) => ({
    id: d.id,
    load_number: d.load_number,
    order_no: d.order_no,
    po_no: d.po_no,
    pack_date: d.pack_date,
    pickup_on: d.actual_pickup_on,
    delivery_on: d.actual_delivery_on,
    boxes: d.stock_boxes,
    status: d.is_complete ? "complete" : "pending",
    consignor: d.consignor_ft_id ? consignorName.get(d.consignor_ft_id) ?? null : null,
    destination: d.consignee_ft_id ? consigneeName.get(d.consignee_ft_id) ?? null : null,
    carrier: d.carrier_ft_id ? carrierName.get(d.carrier_ft_id) ?? null : null,
  }));

  return NextResponse.json(result);
}
