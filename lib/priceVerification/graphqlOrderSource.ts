/**
 * Live-GraphQL order source, for quote periods that PREDATE the local sync.
 *
 * The app never uses this — it reads Postgres (see dbOrderSource.ts), where a
 * week of orders is three indexed queries. This path exists only for
 * backtesting a historical week, and it is where the sprint's rate-limit
 * discipline actually applies: line detail costs 2 calls per order, so a wide
 * window is hundreds of calls.
 *
 * THE DISCIPLINE, AND WHY EACH PART IS HERE
 *  - Pacing. A minimum gap between calls, because both MCP routes to FreshTrack
 *    hung after bursts of roughly six queries during sprint testing and stayed
 *    down until restarted. Throughput is not the constraint here; not knocking
 *    the server over is. Calls are strictly sequential — there is no pool, on
 *    purpose, because concurrency is what produced those bursts.
 *  - Per-request timeout. Without one a single hung request stalls the whole
 *    walk silently, which is exactly the failure that was observed. It is
 *    passed to the shared transport, which raises it as a TransportError so
 *    the existing backoff/retry covers it.
 *  - Checkpointing. Progress is written after every order, so a killed run
 *    resumes instead of re-spending every call.
 *  - filterArchived is never set to true. That flag is what hung the server;
 *    Q_ORDERS_BY_CONSIGNEES pins it to false, which is the safe value.
 *
 * CALL BUDGET: 3 fixed calls (entities, order states, orders) + 2 per order.
 */
import "server-only";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_ENTITIES_FOR_RULE_VALIDATION,
  Q_ORDER_STATES,
  Q_ORDERS_BY_CONSIGNEES,
  Q_ORDER_VERSIONS_BY_ORDER,
  Q_ORDER_ITEMS_BY_ORDER_VERSION,
  type RspOrderVersions,
  type RspOrderItems,
  type RspOrderStates,
  type FTOrderCandidate,
  type FTEntity,
} from "@/lib/freshtrack/queries";
import type { OrderInput, OrderLineInput } from "./types";

export interface PacedOptions {
  /** Minimum gap between outbound calls. */
  minGapMs?: number;
  /** Abort any single request after this long. */
  timeoutMs?: number;
  /** File to checkpoint progress into, so a killed run resumes. */
  checkpointPath?: string;
  log?: (message: string) => void;
}

const DEFAULTS = { minGapMs: 1_100, timeoutMs: 15_000 } as const;

/** Brisbane is UTC+10 year-round. */
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

interface Checkpoint {
  periodStart: string;
  periodEnd: string;
  entityCodes: string[];
  orders: OrderInput[];
  /** FreshTrack order ids whose line detail has already been fetched. */
  done: string[];
}

export async function fetchOrdersViaGraphQL(
  periodStart: string,
  periodEnd: string,
  entityCodes: string[],
  options: PacedOptions = {}
): Promise<OrderInput[]> {
  const log = options.log ?? (() => {});
  const pace = makePacer(
    options.minGapMs ?? DEFAULTS.minGapMs,
    options.timeoutMs ?? DEFAULTS.timeoutMs,
    log
  );

  const checkpoint = loadCheckpoint(options.checkpointPath, periodStart, periodEnd, entityCodes);
  if (checkpoint) {
    log(
      `[resume] checkpoint holds ${checkpoint.orders.length} order(s); ` +
        `${checkpoint.done.length} already have line detail — skipping those`
    );
  }

  let orders = checkpoint?.orders;

  if (!orders) {
    // 1. Entity codes → consignee association ids. Orders reference the
    //    consignee ASSOCIATION record, not the entity's own id.
    const entityRes = await pace<{ entities: FTEntity[] }>(
      Q_ENTITIES_FOR_RULE_VALIDATION,
      { limit: 1_000 },
      "entities"
    );
    const wanted = new Set(entityCodes.map((c) => c.toUpperCase()));
    const byConsigneeId = new Map<string, { code: string; name: string }>();
    for (const e of entityRes.entities ?? []) {
      if (e.consigneeId && wanted.has(e.code.toUpperCase())) {
        byConsigneeId.set(e.consigneeId, { code: e.code, name: e.orgName ?? e.code });
      }
    }
    log(`[entities] resolved ${byConsigneeId.size}/${entityCodes.length} consignee id(s)`);
    if (byConsigneeId.size === 0) return [];

    // 2. Order state names, so the report reads the same as the app's.
    const stateRes = await pace<RspOrderStates>(Q_ORDER_STATES, {}, "orderStates");
    const stateNames = new Map(
      (stateRes.orderStates ?? []).map((s) => [s.id, s.name as string])
    );

    // 3. Orders in the window. A Brisbane day straddles two UTC days, so the
    //    query window is widened by a day at each end and the exact bucketing
    //    is done here.
    const orderRes = await pace<{ orders: FTOrderCandidate[] }>(
      Q_ORDERS_BY_CONSIGNEES,
      {
        consigneeIds: Array.from(byConsigneeId.keys()),
        limit: 1_000,
        deliveryStart: `${addDays(periodStart, -1)}T00:00:00+00:00`,
        deliveryEnd: `${addDays(periodEnd, 2)}T00:00:00+00:00`,
      },
      "orders"
    );

    orders = (orderRes.orders ?? [])
      .filter((o) => !o.isArchived && o.consigneeId && byConsigneeId.has(o.consigneeId))
      .map((o) => {
        const entity = byConsigneeId.get(o.consigneeId!)!;
        return {
          orderFtId: o.id,
          orderNo: o.orderNo ?? null,
          stateName: stateNames.get(o.stateId) ?? null,
          consigneeCode: entity.code,
          consigneeName: entity.name,
          deliveryDate: brisbaneDate(o.scheduledDeliveryOn),
          lines: [] as OrderLineInput[],
        } satisfies OrderInput;
      })
      .filter((o) => o.deliveryDate !== null &&
                     o.deliveryDate >= periodStart &&
                     o.deliveryDate <= periodEnd);

    log(`[orders] ${orders.length} order(s) delivering ${periodStart}..${periodEnd}`);
    saveCheckpoint(options.checkpointPath, {
      periodStart, periodEnd, entityCodes, orders, done: [],
    });
  }

  // 4. Line detail: versions → items of the HIGHEST version. Only the latest
  //    version is the live order; earlier ones carry superseded prices.
  const done = new Set(checkpoint?.done ?? []);

  for (const order of orders) {
    if (done.has(order.orderFtId)) continue;

    const versions = await pace<RspOrderVersions>(
      Q_ORDER_VERSIONS_BY_ORDER,
      { orderId: order.orderFtId },
      `versions:${order.orderNo}`
    );

    const latest = (versions.orderVersions ?? []).reduce<{ id: string; versionNo: number } | null>(
      (best, v) => (!best || v.versionNo > best.versionNo ? { id: v.id, versionNo: v.versionNo } : best),
      null
    );

    if (latest) {
      const items = await pace<RspOrderItems>(
        Q_ORDER_ITEMS_BY_ORDER_VERSION,
        { orderVersionId: latest.id },
        `items:${order.orderNo} v${latest.versionNo}`
      );
      order.lines = (items.orderItems ?? [])
        .map((i) => ({
          lineNo: i.lineNo ?? null,
          itemNo: i.itemNo === null || i.itemNo === undefined ? null : String(i.itemNo),
          description: null,
          quantity: i.proposedQuantity ?? null,
          priceValue: i.priceValue === null ? null : Number(i.priceValue),
          pricePer: i.pricePer ?? null,
        }))
        .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
    }

    done.add(order.orderFtId);
    saveCheckpoint(options.checkpointPath, {
      periodStart, periodEnd, entityCodes, orders, done: Array.from(done),
    });

    if (done.size % 10 === 0) log(`[items] ${done.size}/${orders.length} orders done`);
  }

  return orders;
}

/**
 * Serialises calls and holds them at least `minGapMs` apart, logging the wait
 * and duration of each so the transcript shows the pacing actually happened
 * rather than merely claiming it.
 */
function makePacer(minGapMs: number, timeoutMs: number, log: (m: string) => void) {
  let lastCallAt = 0;
  let callCount = 0;

  return async function pace<T>(
    query: string,
    variables: Record<string, unknown>,
    label: string
  ): Promise<T> {
    const waitMs = Math.max(0, lastCallAt + minGapMs - Date.now());
    if (waitMs > 0) await sleep(waitMs);

    const startedAt = Date.now();
    try {
      const result = await gqlQuery<T>(query, variables, { timeoutMs });
      callCount++;
      log(`[call ${callCount}] ${label} — paced ${waitMs}ms, took ${Date.now() - startedAt}ms`);
      return result;
    } catch (err) {
      log(
        `[call ${callCount + 1}] ${label} FAILED after ${Date.now() - startedAt}ms: ` +
          (err instanceof Error ? err.message : String(err))
      );
      throw err;
    } finally {
      lastCallAt = Date.now();
    }
  };
}

function loadCheckpoint(
  path: string | undefined,
  periodStart: string,
  periodEnd: string,
  entityCodes: string[]
): Checkpoint | null {
  if (!path || !existsSync(path)) return null;
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
    // Only resume a checkpoint describing the same question — resuming into a
    // different window would silently blend two runs' data.
    const sameScope =
      saved.periodStart === periodStart &&
      saved.periodEnd === periodEnd &&
      saved.entityCodes.slice().sort().join(",") === entityCodes.slice().sort().join(",");
    return sameScope ? saved : null;
  } catch {
    return null;
  }
}

function saveCheckpoint(path: string | undefined, checkpoint: Checkpoint): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(checkpoint), "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function brisbaneDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
