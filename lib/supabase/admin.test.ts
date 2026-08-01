import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAdminClient } from "./admin";

/**
 * Regression guard for the scheduled-run staleness incident (30 Jul - 1 Aug
 * 2026).
 *
 * supabase-js issues PostgREST reads as plain GET through global fetch, which
 * Next.js patches and caches in its Data Cache. Writes (POST/PATCH) and the
 * FreshTrack GraphQL transport (POST) are never cached, so /api/cron/processes
 * wrote perfectly fresh process_runs rows while reading a process_definitions
 * snapshot frozen at its very first tick: it ran the assign process in dry_run
 * for hours after the mode was switched to apply, and never once dispatched
 * the report process, which was still `enabled: false` in that snapshot.
 *
 * If this assertion fails, scheduled runs are silently reading stale
 * configuration again — a failure mode with no error, no log line, and a
 * green-looking Tools UI, because the UI routes call cookies() before their
 * read and so get an implicit cache opt-out the cron route never had.
 */
describe("createAdminClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends reads with cache: no-store so Next.js cannot serve them from the Data Cache", async () => {
    await createAdminClient()
      .from("process_definitions")
      .select("key, config")
      .eq("enabled", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;

    // GET is the cacheable verb — the one that regressed.
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it("sends writes with cache: no-store too", async () => {
    await createAdminClient()
      .from("process_runs")
      .insert({ process_key: "consignor_auto_assign", status: "running" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.cache).toBe("no-store");
  });
});
