/**
 * GET — the full run as a CSV download. Every order in the window appears,
 * including skipped and unmapped ones, so the file reconciles against the
 * run totals rather than quietly showing only the interesting rows.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { buildCsv, reportFileName } from "@/lib/priceVerification/report";
import { TOOL_KEY, type ComparedLine, type ComparedOrder } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: run } = await admin
    .from("price_verification_runs")
    .select("id, quote_file_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { data: quoteFile } = await admin
    .from("price_quote_files")
    .select("retailer, period_start, period_end")
    .eq("id", run.quote_file_id as string)
    .maybeSingle();

  const orders = await fetchAll(admin, "price_verification_orders", params.id, {
    order: "delivery_date",
  });
  const lines = await fetchAll(admin, "price_verification_lines", params.id, {
    order: "line_no",
  });

  const linesByOrder = new Map<string, ComparedLine[]>();
  for (const l of lines) {
    const key = l.order_row_id as string;
    const bucket = linesByOrder.get(key) ?? [];
    bucket.push({
      lineNo: l.line_no as number | null,
      itemNo: l.item_no as string | null,
      description: l.description as string | null,
      quantity: l.quantity as number | null,
      orderPrice: l.order_price === null ? null : Number(l.order_price),
      pricePer: l.price_per as string | null,
      quotePrice: l.quote_price === null ? null : Number(l.quote_price),
      variance: l.variance === null ? null : Number(l.variance),
      outcome: l.outcome as ComparedLine["outcome"],
      detail: l.detail as string | null,
    });
    linesByOrder.set(key, bucket);
  }

  const compared: ComparedOrder[] = orders.map((o) => ({
    orderFtId: (o.order_ft_id as string) ?? "",
    orderNo: o.order_no as string | null,
    stateName: o.order_state as string | null,
    consigneeCode: o.consignee_code as string | null,
    consigneeName: o.consignee_name as string | null,
    dcCode: o.dc_code as string | null,
    deliveryDate: o.delivery_date as string | null,
    outcome: o.outcome as ComparedOrder["outcome"],
    reason: o.reason as string | null,
    duplicateGroup: o.duplicate_group as string | null,
    isDuplicate: Boolean(o.is_duplicate),
    linesTotal: (o.lines_total as number) ?? 0,
    linesMatched: (o.lines_matched as number) ?? 0,
    linesMismatched: (o.lines_mismatched as number) ?? 0,
    linesNoQuote: (o.lines_no_quote as number) ?? 0,
    lines: linesByOrder.get(o.id as string) ?? [],
  }));

  const csv = buildCsv(compared);
  const fileName = reportFileName(
    (quoteFile?.retailer as string) ?? "quote",
    (quoteFile?.period_start as string) ?? "start",
    (quoteFile?.period_end as string) ?? "end"
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Pages through a result set. PostgREST caps a response at 1,000 rows, and a
 * week of Coles orders exceeds that in lines — an unpaged read would silently
 * truncate the export.
 */
async function fetchAll(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  runId: string,
  opts: { order: string }
): Promise<Record<string, unknown>[]> {
  const PAGE = 1_000;
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq("run_id", runId)
      .order(opts.order, { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
