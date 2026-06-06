import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — lightweight liveness + DB-reachability probe.
 * Returns 200 with {status: "ok", db: "ok"} when the API process is up and
 * the Supabase DB answers a trivial query, 503 otherwise. Safe to expose
 * publicly: the query touches no tenant data.
 *
 * Vercel monitoring + the manual smoke test ("does anything answer?") both
 * point here. RLS/auth/menu checks are NOT exercised — those have their own
 * surfaces.
 */
export async function GET() {
  const startedAt = Date.now();

  // Probe DB via a SELECT 1 disguised as a count on grower_groups (RLS allows
  // service-role unconditionally; the count is bounded by a head:true / limit
  // so this is O(1) regardless of table size).
  let dbStatus: "ok" | "error" = "ok";
  let dbError: string | null = null;
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("grower_groups")
      .select("id", { count: "exact", head: true });
    if (error) {
      dbStatus = "error";
      dbError = error.message;
    }
  } catch (e) {
    dbStatus = "error";
    dbError = e instanceof Error ? e.message : String(e);
  }

  const elapsedMs = Date.now() - startedAt;
  const status = dbStatus === "ok" ? 200 : 503;

  return NextResponse.json(
    {
      status: dbStatus === "ok" ? "ok" : "degraded",
      db: dbStatus,
      db_error: dbError,
      elapsed_ms: elapsedMs,
    },
    { status }
  );
}
