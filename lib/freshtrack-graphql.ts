/**
 * FreshTrack GraphQL transport. Server-only — never bundle to client.
 *
 * Architecture (per the multi-agent design synthesis):
 *  - Two-layer token cache: module-level `cached` (warm instance) +
 *    `private.freshtrack_auth_cache` row (cold-start cross-instance).
 *  - Singleflight re-auth via `inFlightAuth` Promise — concurrent
 *    `getToken()` callers share one outbound auth call.
 *  - Proactive re-auth when `expiresOn - now < 7 days` (the FT token
 *    lasts ~6 months; one auth/week worst case).
 *  - Error classification by `errors[0].code`, NOT HTTP status: the FT
 *    GraphQL API returns HTTP 200 on auth failures, syntax errors, and
 *    missing-field errors (verified live).
 *  - Exponential backoff (300ms / 1s / 3s) for TransportError (5xx/network).
 *  - AuthCredentialsError / GraphQLAppError are fatal: bubble to the cron
 *    which records the failure in sync_logs and exits.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// --- env ----------------------------------------------------------------

const FT_URL =
  process.env.FT_GRAPHQL_URL ??
  "https://mackaysmarketing.freshtrack.com/api/graphql";

function getCredentials(): { email: string; password: string } {
  const email = process.env.FT_GRAPHQL_EMAIL;
  const password = process.env.FT_GRAPHQL_PASSWORD;
  if (!email || !password) {
    throw new ConfigError(
      "FT_GRAPHQL_EMAIL and FT_GRAPHQL_PASSWORD must be set for FreshTrack sync"
    );
  }
  return { email, password };
}

// --- error hierarchy ----------------------------------------------------

export class FreshtrackError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Misconfigured env / missing secret. Fatal. */
export class ConfigError extends FreshtrackError {}

/** auth/credentials-incorrect — rotate creds. Fatal. */
export class AuthCredentialsError extends FreshtrackError {}

/** auth/auth-required or auth/token-expired — re-auth and retry once. */
export class AuthExpiredError extends FreshtrackError {}

/** Auth still failing after re-auth. Fatal. */
export class PermanentAuthError extends FreshtrackError {}

/** GraphQL schema mismatch / app-level error. Fatal (don't retry). */
export class GraphQLAppError extends FreshtrackError {
  constructor(message: string, code?: string, public readonly details?: unknown) {
    super(message, code);
  }
}

/** Network / 5xx — exponential backoff retry. */
export class TransportError extends FreshtrackError {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message, "transport");
  }
}

/** HTTP 429. Honour Retry-After. */
export class RateLimitError extends FreshtrackError {
  constructor(message: string, public readonly retryAfterSeconds?: number) {
    super(message, "rate-limit");
  }
}

// --- token cache ---------------------------------------------------------

type CachedToken = { token: string; expiresOn: Date };
let cached: CachedToken | null = null;
let inFlightAuth: Promise<CachedToken> | null = null;

const PROACTIVE_REFRESH_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function isTokenFresh(c: CachedToken | null, atMs = Date.now()): boolean {
  if (!c) return false;
  return c.expiresOn.getTime() - atMs > PROACTIVE_REFRESH_DAYS * MS_PER_DAY;
}

/**
 * Returns a token, re-authenticating if the cache is empty, stale, or within
 * the proactive-refresh window. Concurrent callers share the same auth call
 * via the singleflight Promise.
 */
export async function getToken(): Promise<string> {
  if (isTokenFresh(cached)) return cached!.token;

  if (inFlightAuth) {
    const result = await inFlightAuth;
    return result.token;
  }

  inFlightAuth = obtainToken().finally(() => {
    inFlightAuth = null;
  });
  const result = await inFlightAuth;
  return result.token;
}

/** Forces a re-authentication regardless of cache state. */
export async function authenticate(): Promise<CachedToken> {
  cached = null;
  inFlightAuth = null;
  return obtainToken();
}

async function obtainToken(): Promise<CachedToken> {
  // 1. Try Supabase-backed cache for cold-start cross-instance reuse.
  const fromDb = await loadTokenFromDb();
  if (isTokenFresh(fromDb)) {
    cached = fromDb;
    return fromDb!;
  }

  // 2. Fresh-mint via the GraphQL mutation.
  const minted = await mintTokenViaGraphQL();
  cached = minted;
  await saveTokenToDb(minted).catch(() => {
    // Cache write failure is non-fatal; module-level cache still works.
  });
  return minted;
}

async function loadTokenFromDb(): Promise<CachedToken | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("private" as never)
      .from("freshtrack_auth_cache")
      .select("token, expires_on")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;
    return { token: data.token as string, expiresOn: new Date(data.expires_on as string) };
  } catch {
    return null;
  }
}

async function saveTokenToDb(t: CachedToken): Promise<void> {
  const admin = createAdminClient();
  await admin
    .schema("private" as never)
    .from("freshtrack_auth_cache")
    .upsert(
      {
        id: 1,
        token: t.token,
        expires_on: t.expiresOn.toISOString(),
        created_on: new Date().toISOString(),
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
}

async function mintTokenViaGraphQL(): Promise<CachedToken> {
  const { email, password } = getCredentials();
  const query = `
    mutation Authenticate($email: String!, $credentials: String!) {
      authenticateWithCredentials(authData: { email: $email, credentials: $credentials }) {
        authToken { token expiresOn createdOn }
      }
    }
  `;
  const res = await rawGqlFetch<{
    authenticateWithCredentials: {
      authToken: { token: string; expiresOn: string; createdOn: string };
    };
  }>(query, { email, credentials: password }, /* bearer */ null);

  const t = res.authenticateWithCredentials?.authToken;
  if (!t?.token || !t.expiresOn) {
    throw new GraphQLAppError(
      "authenticateWithCredentials returned no token",
      "app/unhandled",
      res
    );
  }
  return { token: t.token, expiresOn: new Date(t.expiresOn) };
}

// --- main query interface -----------------------------------------------

const MAX_TRANSPORT_RETRIES = 3;
const TRANSPORT_BACKOFF_MS = [300, 1_000, 3_000] as const;

/**
 * Issues a GraphQL POST and returns `data`. Handles transparent re-auth on
 * AuthExpiredError, exponential backoff on TransportError, and Retry-After
 * on RateLimitError. Auth/app errors bubble immediately.
 */
export async function gqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const token = await getToken();
    try {
      return await rawGqlFetch<T>(query, variables, token);
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        // Re-auth once; if it still fails, surface as PermanentAuthError.
        cached = null;
        const fresh = await authenticate().catch((e) => {
          if (e instanceof AuthCredentialsError) throw e;
          throw new PermanentAuthError("re-auth failed", "auth/permanent");
        });
        try {
          return await rawGqlFetch<T>(query, variables, fresh.token);
        } catch (e2) {
          if (e2 instanceof AuthExpiredError) {
            throw new PermanentAuthError(
              "still unauthenticated after re-auth",
              "auth/permanent"
            );
          }
          throw e2;
        }
      }
      if (err instanceof RateLimitError) {
        if (attempt >= 1) throw err;
        const delayMs = (err.retryAfterSeconds ?? 5) * 1000;
        await sleep(delayMs);
        attempt += 1;
        continue;
      }
      if (err instanceof TransportError) {
        if (attempt >= MAX_TRANSPORT_RETRIES) throw err;
        await sleep(TRANSPORT_BACKOFF_MS[attempt] ?? 3_000);
        attempt += 1;
        continue;
      }
      // AuthCredentialsError, GraphQLAppError, ConfigError → bubble.
      throw err;
    }
  }
}

/**
 * Low-level fetch + GraphQL error classification. No retries here.
 * `bearer` null = no auth header (used for the auth mutation itself).
 */
async function rawGqlFetch<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  bearer: string | null
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(FT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new TransportError(
      `network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (res.status === 429) {
    const ra = res.headers.get("Retry-After");
    const seconds = ra ? Math.max(1, parseInt(ra, 10) || 5) : 5;
    throw new RateLimitError("rate limited", seconds);
  }

  if (res.status >= 500) {
    throw new TransportError(`upstream ${res.status}`, res.status);
  }

  let body: { data?: T; errors?: GraphQLErrorObject[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new TransportError(`non-JSON response (status ${res.status})`, res.status);
  }

  if (body.errors && body.errors.length > 0) {
    classifyAndThrow(body.errors);
  }

  if (body.data === undefined) {
    throw new GraphQLAppError(
      "response missing both data and errors",
      "app/unhandled",
      body
    );
  }

  return body.data;
}

interface GraphQLErrorObject {
  message: string;
  code?: string;
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
  context?: Record<string, unknown>;
}

/** Map the first GraphQL error to a typed exception. Auth codes confirmed live. */
function classifyAndThrow(errors: GraphQLErrorObject[]): never {
  const first = errors[0]!;
  const code = first.code ?? "";
  const msg = `${first.message} [${code}]`;

  if (code === "auth/credentials-incorrect" || code === "auth/user-unknown") {
    throw new AuthCredentialsError(msg, code);
  }
  if (code === "auth/auth-required" || code === "auth/token-expired") {
    throw new AuthExpiredError(msg, code);
  }
  throw new GraphQLAppError(msg, code, errors);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Test-only export: reset module cache between tests ------------------
/** @internal — exported only for unit tests. Do NOT call from sync code. */
export function _resetForTests(): void {
  cached = null;
  inFlightAuth = null;
}
