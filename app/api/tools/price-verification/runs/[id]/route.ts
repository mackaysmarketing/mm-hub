/**
 * GET — the full report for one run: the run header, every order, and (on
 * request, or for the orders that need it) the per-line detail.
 *
 * Lines are returned for orders whose outcome makes them worth reading — the
 * mismatches and the partials — plus any single order the UI expands. A week
 * of Coles orders is thousands of lines and shipping all of them to the browser
 * on first paint would make the report slow to open for no benefit.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { TOOL_KEY } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const orderRowId = url.searchParams.get("orderRowId");
  const outcomeFilter = url.searchParams.get("outcome");

  const admin = createAdminClient();

  const { data: run, error: runError } = await admin
    .from("price_verification_runs")
    .select("*")
    .eq("id", params.id)
    .single();
  if (runError || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const { data: quoteFile } = await admin
    .from("price_quote_files")
    .select("id, retailer, file_name, period_start, period_end, parse_warnings")
    .eq("id", run.quote_file_id as string)
    .maybeSingle();

  let ordersQuery = admin
    .from("price_verification_orders")
    .select("*")
    .eq("run_id", params.id)
    .order("delivery_date", { ascending: true })
    .order("order_no", { ascending: true });
  if (outcomeFilter) ordersQuery = ordersQuery.eq("outcome", outcomeFilter);

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  // Which orders' lines to include.
  const wanted = orderRowId
    ? (orders ?? []).filter((o) => o.id === orderRowId)
    : (orders ?? []).filter(
        (o) => o.outcome === "mismatch" || o.outcome === "partial" || o.outcome === "no_quote"
      );

  const lines: Record<string, unknown>[] = [];
  const wantedIds = wanted.map((o) => o.id as string);
  for (let i = 0; i < wantedIds.length; i += 200) {
    const { data } = await admin
      .from("price_verification_lines")
      .select("*")
      .in("order_row_id", wantedIds.slice(i, i + 200))
      .order("line_no", { ascending: true });
    if (data) lines.push(...data);
  }

  return NextResponse.json({ run, quoteFile: quoteFile ?? null, orders: orders ?? [], lines });
}
