/**
 * Backtests a retailer quote week against LIVE FreshTrack GraphQL.
 *
 * WHEN TO USE THIS RATHER THAN THE HUB TOOL
 *   The Hub tool reads the locally-synced order tables, which is faster, safer
 *   and what you want for any current week. It cannot help with a period
 *   predating the sync (the sync holds orders from roughly 2026-06-30 onward);
 *   this script can, at the cost of ~2 GraphQL calls per order.
 *
 *   It is READ-ONLY. It issues queries only — there is no mutation anywhere in
 *   this file or in anything it imports.
 *
 * USAGE
 *   npx tsx scripts/price-verification-backtest.ts \
 *     --quote "C:/path/COLES 07-04-2026 13-04-2026.xlsx" \
 *     --entities COLBR \
 *     --out ./backtest-report.csv
 *
 *   Optional:
 *     --tolerance 0.01        price tolerance in dollars (default 0 = exact)
 *     --unapproved skip|use   how to treat unapproved quote rows (default use)
 *     --min-gap 1100          ms between GraphQL calls
 *     --timeout 15000         ms before a single call is aborted
 *     --checkpoint <path>     resume file (default ./.backtest-checkpoint.json)
 *
 * REQUIRES: FT_GRAPHQL_EMAIL, FT_GRAPHQL_PASSWORD, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (the transport caches its token
 * in Supabase). Pull them with `vercel env pull .env.local` and run with
 * `npx tsx -r dotenv/config`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseQuoteFile } from "@/lib/priceVerification/parseQuote";
import { buildQuoteIndex, compareOrders } from "@/lib/priceVerification/compare";
import { fetchOrdersViaGraphQL } from "@/lib/priceVerification/graphqlOrderSource";
import { buildCsv, buildSummary } from "@/lib/priceVerification/report";
import { loadDcMappings } from "@/lib/priceVerification/settings";
import { DEFAULT_SETTINGS, type VerificationSettings } from "@/lib/priceVerification/types";

interface Args {
  quote: string;
  entities: string[];
  out: string;
  tolerance: number;
  unapproved: "use" | "skip";
  minGap: number;
  timeout: number;
  checkpoint: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const quote = get("--quote");
  if (!quote) {
    throw new Error("--quote <path to the retailer quote file> is required");
  }

  const entities = (get("--entities") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entities.length === 0) {
    throw new Error(
      "--entities <CODE[,CODE...]> is required. Naming the consignees keeps the " +
        "call budget bounded — a whole-retailer backtest is hundreds of calls."
    );
  }

  const unapproved = (get("--unapproved") ?? "use") as "use" | "skip";
  if (unapproved !== "use" && unapproved !== "skip") {
    throw new Error("--unapproved must be 'use' or 'skip'");
  }

  return {
    quote,
    entities,
    out: get("--out") ?? "./backtest-report.csv",
    tolerance: Number(get("--tolerance") ?? 0),
    unapproved,
    minGap: Number(get("--min-gap") ?? 1_100),
    timeout: Number(get("--timeout") ?? 15_000),
    checkpoint: get("--checkpoint") ?? "./.backtest-checkpoint.json",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (m: string) => console.log(m);

  const parsed = parseQuoteFile(readFileSync(args.quote), args.quote);
  log(
    `[quote] ${parsed.retailer} — ${parsed.rowCount} row(s) → ${parsed.lines.length} ` +
      `per-day line(s), ${parsed.periodStart}..${parsed.periodEnd}, DCs: ${parsed.dcCodes.join(", ")}`
  );
  for (const w of parsed.warnings.slice(0, 20)) {
    log(`[quote] row ${w.row} skipped: ${w.reason}`);
  }
  if (parsed.warnings.length > 20) {
    log(`[quote] …and ${parsed.warnings.length - 20} more skipped row(s)`);
  }

  const settings: VerificationSettings = {
    ...DEFAULT_SETTINGS,
    tolerance: args.tolerance,
    unapprovedQuotes: args.unapproved,
  };

  const mappings = await loadDcMappings(parsed.retailer);
  log(
    `[config] ${mappings.length} DC mapping(s); verifying states ` +
      `${settings.verifiableStates.join("/")} at tolerance $${settings.tolerance}`
  );

  const startedAt = Date.now();
  const orders = await fetchOrdersViaGraphQL(
    parsed.periodStart,
    parsed.periodEnd,
    args.entities,
    {
      minGapMs: args.minGap,
      timeoutMs: args.timeout,
      checkpointPath: args.checkpoint,
      log,
    }
  );
  log(`[fetch] ${orders.length} order(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  const result = compareOrders(orders, buildQuoteIndex(parsed.lines), mappings, settings);

  console.log("");
  console.log(
    buildSummary({
      retailer: parsed.retailer,
      fileName: args.quote,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      totals: result.totals,
    })
  );

  writeFileSync(args.out, buildCsv(result.orders), "utf8");
  console.log(`\nReport written to ${args.out}`);

  // A non-reconciling total means the report is not trustworthy, so say so
  // loudly rather than letting it look like a clean run.
  const t = result.totals;
  const bucketSum =
    t.ordersVerified + t.ordersMismatched + t.ordersPartial +
    t.ordersNoQuote + t.ordersSkipped + t.ordersUnmapped;
  if (bucketSum !== t.ordersTotal) {
    console.error(
      `TOTALS DO NOT RECONCILE: buckets sum to ${bucketSum} but ${t.ordersTotal} orders were seen.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
