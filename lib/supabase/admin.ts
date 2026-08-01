import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-side reads/writes.
 *
 * `cache: "no-store"` is NOT optional. supabase-js issues PostgREST reads as
 * plain GET requests through global fetch, which Next.js patches and caches in
 * its Data Cache. Writes (POST/PATCH) and the FreshTrack GraphQL transport
 * (POST) are never cached, so a route can happily write fresh rows while
 * reading a frozen snapshot of its own configuration — which is exactly what
 * happened: /api/cron/processes served process_definitions from a snapshot
 * taken on its first tick (2026-07-30 08:01 UTC) and never saw a settings
 * change again. It kept running the assign process in dry_run for hours after
 * the mode was switched to apply, and never once dispatched the report
 * process, which was still `enabled: false` in that snapshot.
 *
 * The route-level `export const dynamic = "force-dynamic"` does not cover
 * this — it forces dynamic rendering, not a fetch-level cache opt-out. The API
 * routes that looked correct only did so by accident: they call cookies()
 * (via getUserSession/getPortalAccessContext) before their Supabase read,
 * which opts those fetches out. The cron route reads `request.headers` off the
 * Request object, which is not a dynamic function, so nothing opted it out.
 *
 * Setting it here rather than per-route covers every call site at once,
 * including the ones where staleness would be silent rather than visible
 * (consignor_assignment_rules in the assign engine, the freshtrack_auth_cache
 * token row).
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}
