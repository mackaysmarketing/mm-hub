/**
 * Verification orchestration: quote file → orders → verdicts → persisted run.
 *
 * This tool NEVER writes to FreshTrack. There are no mutations anywhere in this
 * module or anything it calls; the only writes are into the Hub's own
 * price_verification_* tables. Moving a verified order to a "Price Verified"
 * state is deliberately not implemented — that state does not exist in
 * FreshTrack yet, and which transitions would be legal is undecided (sprint
 * D3). When it is built it belongs behind an explicit apply flag and an
 * allowlist of state transitions, mirroring how consignor_auto_assign gates its
 * writes.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { compareOrders, buildQuoteIndex } from "./compare";
import { checkCoverage, fetchOrdersForWindow } from "./dbOrderSource";
import { entityCodesFor, loadDcMappings, loadSettings } from "./settings";
import type {
  ComparedOrder,
  QuoteLine,
  Retailer,
  VerificationResult,
  VerificationSettings,
} from "./types";

export interface RunOutcome {
  runId: string;
  result: VerificationResult;
  coverage: Awaited<ReturnType<typeof checkCoverage>>;
  settings: VerificationSettings;
}

export async function runVerification(
  quoteFileId: string,
  triggeredBy: string | null
): Promise<RunOutcome> {
  const admin = createAdminClient();

  const { data: quoteFile, error: quoteError } = await admin
    .from("price_quote_files")
    .select("id, retailer, period_start, period_end, file_name")
    .eq("id", quoteFileId)
    .single();
  if (quoteError || !quoteFile) {
    throw new Error(`quote file ${quoteFileId} not found`);
  }

  const retailer = quoteFile.retailer as Retailer;
  const periodStart = quoteFile.period_start as string;
  const periodEnd = quoteFile.period_end as string;

  const [settings, mappings, coverage] = await Promise.all([
    loadSettings(),
    loadDcMappings(retailer),
    checkCoverage(periodStart, periodEnd),
  ]);

  const { data: run, error: runError } = await admin
    .from("price_verification_runs")
    .insert({
      quote_file_id: quoteFileId,
      status: "running",
      triggered_by: triggeredBy,
      settings: {
        tolerance: settings.tolerance,
        verifiableStates: settings.verifiableStates,
        skipStates: settings.skipStates,
        unapprovedQuotes: settings.unapprovedQuotes,
      },
      coverage: coverage as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`could not start run: ${runError?.message}`);

  const runId = run.id as string;

  try {
    const quoteLines = await loadQuoteLines(quoteFileId);
    const entityCodes = entityCodesFor(mappings);
    const orders = await fetchOrdersForWindow(periodStart, periodEnd, entityCodes);

    const result = compareOrders(
      orders,
      buildQuoteIndex(quoteLines),
      mappings,
      settings
    );

    await persistResults(runId, result.orders);

    await admin
      .from("price_verification_runs")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        orders_total: result.totals.ordersTotal,
        orders_verified: result.totals.ordersVerified,
        orders_mismatched: result.totals.ordersMismatched,
        orders_partial: result.totals.ordersPartial,
        orders_no_quote: result.totals.ordersNoQuote,
        orders_skipped: result.totals.ordersSkipped,
        orders_unmapped: result.totals.ordersUnmapped,
        orders_duplicate: result.totals.ordersDuplicate,
        lines_total: result.totals.linesTotal,
        lines_matched: result.totals.linesMatched,
        lines_mismatched: result.totals.linesMismatched,
        lines_no_quote: result.totals.linesNoQuote,
      })
      .eq("id", runId);

    return { runId, result, coverage, settings };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await admin
      .from("price_verification_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: message })
      .eq("id", runId);
    throw err;
  }
}

async function loadQuoteLines(quoteFileId: string): Promise<QuoteLine[]> {
  const admin = createAdminClient();
  const PAGE = 1_000;
  const out: QuoteLine[] = [];

  // Paged: PostgREST caps a response at 1,000 rows by default and a multi-DC
  // Coles week is well over that (62 rows × 7 days = 434 for one file, more
  // once several DCs and a longer range are in play). Reading only the first
  // page would silently turn real quote rows into "no quote line".
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("price_quote_lines")
      .select("retailer, dc_code, article_no, description, effective_on, price, approved, order_multiple")
      .eq("quote_file_id", quoteFileId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`could not load quote lines: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      out.push({
        retailer: r.retailer as Retailer,
        dcCode: r.dc_code as string,
        articleNo: String(r.article_no),
        description: (r.description as string) ?? null,
        effectiveOn: r.effective_on as string,
        price: r.price === null ? null : Number(r.price),
        approved: Boolean(r.approved),
        orderMultiple: (r.order_multiple as number) ?? null,
      });
    }
    if (data.length < PAGE) break;
  }

  return out;
}

async function persistResults(runId: string, orders: ComparedOrder[]): Promise<void> {
  const admin = createAdminClient();
  const CHUNK = 200;

  for (let i = 0; i < orders.length; i += CHUNK) {
    const batch = orders.slice(i, i + CHUNK);

    const { data: inserted, error } = await admin
      .from("price_verification_orders")
      .insert(
        batch.map((o) => ({
          run_id: runId,
          order_ft_id: o.orderFtId,
          order_no: o.orderNo,
          order_state: o.stateName,
          consignee_code: o.consigneeCode,
          consignee_name: o.consigneeName,
          dc_code: o.dcCode,
          delivery_date: o.deliveryDate,
          outcome: o.outcome,
          reason: o.reason,
          duplicate_group: o.duplicateGroup,
          is_duplicate: o.isDuplicate,
          lines_total: o.linesTotal,
          lines_matched: o.linesMatched,
          lines_mismatched: o.linesMismatched,
          lines_no_quote: o.linesNoQuote,
        }))
      )
      .select("id");
    if (error) throw new Error(`could not save order results: ${error.message}`);

    // insert() returns rows in the order supplied, so index alignment holds.
    const lineRows = batch.flatMap((o, idx) =>
      o.lines.map((l) => ({
        run_id: runId,
        order_row_id: inserted![idx]!.id as string,
        line_no: l.lineNo,
        item_no: l.itemNo,
        description: l.description,
        quantity: l.quantity,
        order_price: l.orderPrice,
        price_per: l.pricePer,
        quote_price: l.quotePrice,
        variance: l.variance,
        outcome: l.outcome,
        detail: l.detail,
      }))
    );

    for (let j = 0; j < lineRows.length; j += 500) {
      const { error: lineError } = await admin
        .from("price_verification_lines")
        .insert(lineRows.slice(j, j + 500));
      if (lineError) throw new Error(`could not save line results: ${lineError.message}`);
    }
  }
}
