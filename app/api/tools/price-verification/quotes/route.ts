/**
 * GET  — list uploaded quote files.
 * POST — upload and parse a quote file (multipart/form-data, field "file").
 *
 * Parsing happens on upload, not at verification time, so a bad file is
 * rejected while the person who chose it is still looking at the screen.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { parseQuoteFile, QuoteParseError } from "@/lib/priceVerification/parseQuote";
import { ensureDcRowsExist } from "@/lib/priceVerification/settings";
import { TOOL_KEY } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

/** Guards against a large workbook being pulled entirely into a lambda. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function GET() {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("price_quote_files")
    .select("id, retailer, file_name, period_start, period_end, line_count, row_count, parse_warnings, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach each file's latest run so the list can show its status without a
  // second round trip per row.
  const ids = (data ?? []).map((d) => d.id as string);
  const latestByQuote = new Map<string, Record<string, unknown>>();
  if (ids.length > 0) {
    const { data: runs } = await admin
      .from("price_verification_runs")
      .select("id, quote_file_id, status, started_at, completed_at, orders_total, orders_verified, orders_mismatched, lines_total, lines_matched, lines_mismatched")
      .in("quote_file_id", ids)
      .order("started_at", { ascending: false });
    for (const r of runs ?? []) {
      const key = r.quote_file_id as string;
      if (!latestByQuote.has(key)) latestByQuote.set(key, r);
    }
  }

  return NextResponse.json(
    (data ?? []).map((d) => ({ ...d, latestRun: latestByQuote.get(d.id as string) ?? null }))
  );
}

export async function POST(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed || !access.session) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "No file supplied" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is 10MB` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseQuoteFile(buffer, file.name);
  } catch (err) {
    if (err instanceof QuoteParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const admin = createAdminClient();
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Re-uploading the same bytes replaces the prior parse rather than creating a
  // second quote competing for the same week. Runs already made against the old
  // row cascade away with it, which is correct — they described that parse.
  const { data: existing } = await admin
    .from("price_quote_files")
    .select("id")
    .eq("file_hash", fileHash)
    .maybeSingle();
  if (existing) {
    await admin.from("price_quote_files").delete().eq("id", existing.id as string);
  }

  const { data: quoteFile, error: insertError } = await admin
    .from("price_quote_files")
    .insert({
      retailer: parsed.retailer,
      file_name: file.name,
      file_hash: fileHash,
      period_start: parsed.periodStart,
      period_end: parsed.periodEnd,
      line_count: parsed.lines.length,
      row_count: parsed.rowCount,
      parse_warnings: parsed.warnings,
      uploaded_by: access.session.hubUser.id,
    })
    .select("id")
    .single();
  if (insertError || !quoteFile) {
    return NextResponse.json(
      { error: insertError?.message ?? "could not save quote file" },
      { status: 500 }
    );
  }

  const quoteFileId = quoteFile.id as string;
  const rows = parsed.lines.map((l) => ({
    quote_file_id: quoteFileId,
    retailer: l.retailer,
    dc_code: l.dcCode,
    article_no: l.articleNo,
    description: l.description,
    effective_on: l.effectiveOn,
    price: l.price,
    approved: l.approved,
    order_multiple: l.orderMultiple,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error: lineError } = await admin
      .from("price_quote_lines")
      .insert(rows.slice(i, i + 500));
    if (lineError) {
      // Leave nothing half-stored — the file row would otherwise claim a line
      // count it does not have.
      await admin.from("price_quote_files").delete().eq("id", quoteFileId);
      return NextResponse.json({ error: lineError.message }, { status: 500 });
    }
  }

  await ensureDcRowsExist(parsed.retailer, parsed.dcCodes);

  return NextResponse.json({
    id: quoteFileId,
    retailer: parsed.retailer,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    rowCount: parsed.rowCount,
    lineCount: parsed.lines.length,
    dcCodes: parsed.dcCodes,
    warnings: parsed.warnings,
    replacedPrevious: Boolean(existing),
  });
}
