/**
 * Sliding-date-window paginator with binary-shrink on overflow.
 *
 * Why: FT GraphQL exposes no cursor/offset/after pagination across any of
 * the 196 root queries (verified). The only safe way to drain a date range
 * larger than `filterLimit` is to slide the window and re-query. If a
 * single window returns exactly `limit` rows, we ASSUME we hit the cap and
 * halve the window until rows.length < limit.
 *
 * Idempotency is provided by upserts on `freshtrack_id`, so an overlap
 * between consecutive windows just re-writes the same row.
 */
import "server-only";

const MS_PER_DAY = 86_400_000;

export interface WindowedFetchCtx {
  limit: number;
  /** Overlap between consecutive windows (defaults to 7 days). */
  overlapDays?: number;
  /** Minimum sub-window size before we give up shrinking (defaults to 1 day). */
  minWindowDays?: number;
}

export interface WindowedResult<T> {
  rows: T[];
  windows: number;
  calls: number;
}

/**
 * Drain a date range by repeated calls to `fetcher(start, end)`, shrinking
 * the window when results hit the limit (likely truncation). Returns
 * deduplicated rows by `getId`.
 *
 *   start              fetcher window
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ end
 *   <----- window 1 ----->
 *               <-- overlap -->
 *                      <----- window 2 ----->
 */
export async function ftPagedDateWindow<T>(
  start: Date,
  end: Date,
  ctx: WindowedFetchCtx,
  fetcher: (windowStart: Date, windowEnd: Date) => Promise<T[]>,
  getId: (row: T) => string
): Promise<WindowedResult<T>> {
  // overlapDays is currently advisory only — cross-run overlap is the
  // cursor module's responsibility (it adjusts nextCursorAt = now() - lookback).
  // Kept on the public ctx so callers can pre-declare intent.
  void ctx.overlapDays;
  const minWindowMs = (ctx.minWindowDays ?? 1) * MS_PER_DAY;

  const seen = new Map<string, T>();
  let calls = 0;
  let windows = 0;
  let cursor = start.getTime();
  const endMs = end.getTime();

  // Initial window size = the full range; will shrink on overflow.
  let windowMs = endMs - cursor;

  while (cursor < endMs) {
    const wStart = new Date(cursor);
    const wEnd = new Date(Math.min(cursor + windowMs, endMs));
    calls += 1;
    windows += 1;
    const rows = await fetcher(wStart, wEnd);

    if (rows.length === ctx.limit && windowMs > minWindowMs) {
      // Overflow — halve and retry the same window from the same cursor.
      windowMs = Math.max(Math.floor(windowMs / 2), minWindowMs);
      windows -= 1; // don't count overflow-retry as a window
      continue;
    }

    for (const r of rows) seen.set(getId(r), r);

    // Advance past this window. Within a single call there's no need to
    // back up by overlap — the window was either fully drained (rows <
    // limit) or we already shrunk it above. Cross-run retroactive edits
    // are handled by the cursor module choosing
    // nextCursorAt = now() - lookback.
    cursor = wEnd.getTime();
    windowMs = Math.max(endMs - cursor, minWindowMs);
  }

  return { rows: Array.from(seen.values()), windows, calls };
}
