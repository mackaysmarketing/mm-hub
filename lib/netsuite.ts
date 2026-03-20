import OAuth from "oauth-1.0a";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// ⚠️  TBC: The RCTI record type in NetSuite is not yet confirmed.
//     It could be 'vendorBill', 'vendorCredit', or a custom record type.
//     Update this constant once the Mackays finance team confirms.
// ---------------------------------------------------------------------------
const RCTI_RECORD_TYPE = "vendorBill";

// Default page size for NetSuite REST API pagination
const PAGE_LIMIT = 100;

// Retry config for rate limiting (HTTP 429)
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export class NetSuiteClient {
  private accountId: string;
  private oauth: OAuth;
  private token: OAuth.Token;

  constructor() {
    this.accountId = process.env.NETSUITE_ACCOUNT_ID ?? "";
    const consumerKey = process.env.NETSUITE_CONSUMER_KEY ?? "";
    const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET ?? "";
    const tokenId = process.env.NETSUITE_TOKEN_ID ?? "";
    const tokenSecret = process.env.NETSUITE_TOKEN_SECRET ?? "";

    this.oauth = new OAuth({
      consumer: { key: consumerKey, secret: consumerSecret },
      signature_method: "HMAC-SHA256",
      hash_function(baseString, key) {
        return crypto
          .createHmac("sha256", key)
          .update(baseString)
          .digest("base64");
      },
    });

    this.token = { key: tokenId, secret: tokenSecret };
  }

  /** Base URL for SuiteTalk REST Web Services */
  private getBaseUrl(): string {
    // NetSuite account IDs use underscores in URLs (e.g. 1234567_SB1)
    const accountSlug = this.accountId.replace(/-/g, "_").toLowerCase();
    return `https://${accountSlug}.suitetalk.api.netsuite.com/services/rest/`;
  }

  /** Generate OAuth 1.0 Authorization header for a request */
  private getAuthHeader(method: string, url: string): string {
    const requestData = { url, method };
    const authorization = this.oauth.authorize(requestData, this.token);
    const header = this.oauth.toHeader(authorization);
    return header.Authorization;
  }

  /**
   * Make a GET request to the NetSuite REST API with OAuth 1.0 auth.
   * Includes exponential backoff retry for 429 rate limiting.
   */
  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = new URL(endpoint, baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const fullUrl = url.toString();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          Authorization: this.getAuthHeader("GET", fullUrl),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `NetSuite API error: ${response.status} ${response.statusText} — ${body}`
        );
      }

      return (await response.json()) as T;
    }

    // Should never reach here due to the throw above, but TypeScript needs it
    throw new Error("NetSuite API: max retries exceeded");
  }

  /**
   * Search for RCTI records (vendor bills) from NetSuite.
   * Handles pagination automatically (offset/limit, follows hasMore).
   *
   * ⚠️  The record type and query fields are ESTIMATES.
   *     Actual NetSuite field names need verification with the Mackays
   *     finance team and a test API call against the sandbox.
   */
  async searchRCTIs(lastSyncDate?: string): Promise<Record<string, unknown>[]> {
    const allRecords: Record<string, unknown>[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, string> = {
        limit: String(PAGE_LIMIT),
        offset: String(offset),
      };

      // ⚠️  TBC: The SuiteQL query or REST filter syntax depends on how
      //     Mackays has configured their NetSuite instance. This is a
      //     best-guess using standard SuiteQL. May need to switch to
      //     a saved search or RESTlet approach.
      const endpoint = `record/v1/${RCTI_RECORD_TYPE}`;

      if (lastSyncDate) {
        // Filter by last modified date for incremental sync
        params.q = `lastModifiedDate AFTER "${lastSyncDate}"`;
      }

      interface NetSuiteListResponse {
        items?: Record<string, unknown>[];
        hasMore?: boolean;
        totalResults?: number;
        count?: number;
        offset?: number;
      }

      const response = await this.get<NetSuiteListResponse>(endpoint, params);

      const items = response.items ?? [];
      allRecords.push(...items);

      hasMore = response.hasMore ?? false;
      offset += PAGE_LIMIT;
    }

    return allRecords;
  }

  /**
   * Fetch a single RCTI record with line items and charges expanded.
   *
   * ⚠️  The expandSubResources param and sublist names (item, expense)
   *     are ESTIMATES based on standard NetSuite vendorBill schema.
   *     Verify with real API response.
   */
  async getRCTIDetail(
    internalId: string
  ): Promise<Record<string, unknown>> {
    // expandSubResources tells NetSuite to include sublists inline
    return this.get<Record<string, unknown>>(
      `record/v1/${RCTI_RECORD_TYPE}/${internalId}`,
      { expandSubResources: "true" }
    );
  }
}

export const netsuiteClient = new NetSuiteClient();
