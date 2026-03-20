import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getCapabilities(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string[] {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return [];
  return (access.config as Record<string, unknown>).capabilities as string[] ?? [];
}

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("trigger_sync")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [logsResult, configResult] = await Promise.all([
    admin
      .from("sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20),
    admin
      .from("sync_config")
      .select("*")
      .order("sync_source, step_order"),
  ]);

  if (logsResult.error) {
    return NextResponse.json({ error: logsResult.error.message }, { status: 500 });
  }

  const logs = logsResult.data ?? [];
  const config = configResult.data ?? [];

  // Compute summary: last successful sync per source
  const freshtrackLogs = logs.filter((l) => l.source === "freshtrack");
  const netsuiteLogs = logs.filter((l) => l.source === "netsuite");

  const lastFTSuccess = freshtrackLogs.find((l) => l.status === "success");
  const lastNSSuccess = netsuiteLogs.find((l) => l.status === "success");

  return NextResponse.json({
    logs,
    config,
    summary: {
      freshtrack: {
        last_sync: freshtrackLogs[0] ?? null,
        last_success: lastFTSuccess ?? null,
      },
      netsuite: {
        last_sync: netsuiteLogs[0] ?? null,
        last_success: lastNSSuccess ?? null,
      },
    },
  });
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("trigger_sync")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { source } = body as { source: "freshtrack" | "netsuite" };

  if (!source || !["freshtrack", "netsuite"].includes(source)) {
    return NextResponse.json(
      { error: "Invalid source. Must be 'freshtrack' or 'netsuite'" },
      { status: 400 }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const endpoint =
    source === "freshtrack"
      ? `${baseUrl}/api/cron/sync-freshtrack`
      : `${baseUrl}/api/cron/sync-netsuite`;

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: cronSecret
        ? { Authorization: `Bearer ${cronSecret}` }
        : {},
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || `Sync failed with status ${res.status}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to trigger sync: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
