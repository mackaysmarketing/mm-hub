import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the Supabase admin client so the token-cache write/read is a no-op
// in tests. We want to exercise the GraphQL transport logic in isolation.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ data: null, error: null }),
      }),
    }),
  }),
}));

// "server-only" is poison if imported in a non-Server context. Stub it.
vi.mock("server-only", () => ({}));

describe("FreshTrack GraphQL transport — error classification by errors[].code", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    process.env.FT_GRAPHQL_EMAIL = "test@example.com";
    process.env.FT_GRAPHQL_PASSWORD = "secret";
    process.env.FT_GRAPHQL_URL = "https://example.test/graphql";

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    // Reset module-level token cache between tests.
    const mod = await import("./freshtrack-graphql");
    mod._resetForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockJsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  }

  it("auth/credentials-incorrect (returned as HTTP 200) maps to AuthCredentialsError — fatal", async () => {
    // The auth mutation itself returns the error.
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        errors: [
          { message: "User credentials are incorrect.", code: "auth/credentials-incorrect" },
        ],
      })
    );

    const { gqlQuery, AuthCredentialsError } = await import("./freshtrack-graphql");
    await expect(gqlQuery("{ entities { id } }")).rejects.toThrow(AuthCredentialsError);
  });

  it("auth/auth-required triggers ONE re-auth then succeeds; final result returned", async () => {
    // Sequence:
    //   1. auth mutation → success (token A, expires in 365d so isTokenFresh=true)
    //   2. the actual data query → 200 with errors[0].code = auth/auth-required
    //   3. forced re-auth mutation → success (token B)
    //   4. retry data query → success
    const futureA = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const futureB = new Date(Date.now() + 365 * 86_400_000).toISOString();
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            authenticateWithCredentials: {
              authToken: { token: "TOKEN_A", expiresOn: futureA, createdOn: new Date().toISOString() },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          errors: [{ message: "Authentication required", code: "auth/auth-required" }],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            authenticateWithCredentials: {
              authToken: { token: "TOKEN_B", expiresOn: futureB, createdOn: new Date().toISOString() },
            },
          },
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ data: { entities: [{ id: "x" }] } }));

    const { gqlQuery } = await import("./freshtrack-graphql");
    const out = await gqlQuery<{ entities: { id: string }[] }>("{ entities { id } }");
    expect(out.entities[0].id).toBe("x");
    // 4 fetch calls: auth, query (401), re-auth, retry query.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("HTTP 500 retries with backoff; succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    fetchMock
      // 1. auth mutation → success
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            authenticateWithCredentials: {
              authToken: { token: "T", expiresOn: future, createdOn: new Date().toISOString() },
            },
          },
        })
      )
      // 2. query → HTTP 500
      .mockResolvedValueOnce(new Response("upstream busy", { status: 500 }))
      // 3. retry → success
      .mockResolvedValueOnce(mockJsonResponse({ data: { entities: [{ id: "ok" }] } }));

    const { gqlQuery } = await import("./freshtrack-graphql");
    const p = gqlQuery<{ entities: { id: string }[] }>("{ entities { id } }");
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.entities[0].id).toBe("ok");
    vi.useRealTimers();
  });

  it("HTTP 429 (rate-limit) honours Retry-After and retries once", async () => {
    vi.useFakeTimers();
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            authenticateWithCredentials: {
              authToken: { token: "T", expiresOn: future, createdOn: new Date().toISOString() },
            },
          },
        })
      )
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(mockJsonResponse({ data: { entities: [{ id: "ok" }] } }));

    const { gqlQuery } = await import("./freshtrack-graphql");
    const p = gqlQuery<{ entities: { id: string }[] }>("{ entities { id } }");
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.entities[0].id).toBe("ok");
    vi.useRealTimers();
  });

  it("Unknown GraphQL error code → GraphQLAppError (fatal, no retry)", async () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: {
            authenticateWithCredentials: {
              authToken: { token: "T", expiresOn: future, createdOn: new Date().toISOString() },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          errors: [{ message: "Cannot query field 'frobnicate' on type 'Query'", code: "app/unhandled" }],
        })
      );

    const { gqlQuery, GraphQLAppError } = await import("./freshtrack-graphql");
    await expect(gqlQuery("{ frobnicate }")).rejects.toThrow(GraphQLAppError);
    // Only 2 fetches: auth + the bad query. No retry on app errors.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent getToken calls singleflight — only one auth mutation", async () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    let authCalls = 0;
    fetchMock.mockImplementation(async () => {
      authCalls += 1;
      return mockJsonResponse({
        data: {
          authenticateWithCredentials: {
            authToken: { token: "T", expiresOn: future, createdOn: new Date().toISOString() },
          },
        },
      });
    });

    const { getToken } = await import("./freshtrack-graphql");
    // 5 concurrent callers; expect 1 auth call.
    const tokens = await Promise.all(Array.from({ length: 5 }, () => getToken()));
    expect(tokens.every((t) => t === "T")).toBe(true);
    expect(authCalls).toBe(1);
  });
});
