/**
 * GET  — list verification runs.
 * POST — run a verification for a quote file. Read-only against FreshTrack:
 *        this reads the synced order tables and writes only the Hub's own
 *        result tables. No FreshTrack mutation exists anywhere in this path.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess } from "@/lib/tools/access";
import { runVerification } from "@/lib/priceVerification/run";
import { TOOL_KEY } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";
/** A wide multi-DC week can take a while; the platform default is too tight. */
export const maxDuration = 120;

export async function GET(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  const quoteFileId = new URL(request.url).searchParams.get("quoteFileId");
  const admin = createAdminClient();

  let query = admin
    .from("price_verification_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);
  if (quoteFileId) query = query.eq("quote_file_id", quoteFileId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed || !access.session) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }

  let body: { quoteFileId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.quoteFileId) {
    return NextResponse.json({ error: "quoteFileId is required" }, { status: 400 });
  }

  try {
    const outcome = await runVerification(body.quoteFileId, access.session.hubUser.id);
    return NextResponse.json({
      runId: outcome.runId,
      totals: outcome.result.totals,
      coverage: outcome.coverage,
      settings: outcome.settings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
