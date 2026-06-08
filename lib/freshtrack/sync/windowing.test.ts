import { describe, it, expect, vi } from "vitest";

// `server-only` throws on non-server context; stub it for tests.
// vi.mock is hoisted before imports by vitest.
vi.mock("server-only", () => ({}));

import { ftPagedDateWindow } from "./windowing";

interface FakeRow {
  id: string;
  modifiedOn: Date;
}

describe("ftPagedDateWindow — sliding window with binary shrink", () => {
  it("returns all rows in a single window when count < limit", async () => {
    const fetcher = vi.fn(async () => [
      { id: "a", modifiedOn: new Date(2026, 5, 1) },
      { id: "b", modifiedOn: new Date(2026, 5, 2) },
    ]);
    const out = await ftPagedDateWindow<FakeRow>(
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      { limit: 100 },
      fetcher,
      (r) => r.id
    );
    expect(out.rows.length).toBe(2);
    expect(out.calls).toBe(1);
    expect(out.windows).toBe(1);
  });

  it("shrinks the window on overflow (rows.length === limit)", async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return Array.from({ length: 5 }, (_, i) => ({
          id: `o${i}`,
          modifiedOn: new Date(2026, 5, 1 + i),
        }));
      }
      return [{ id: `f${callCount}`, modifiedOn: new Date(2026, 5, 10 + callCount) }];
    });
    const out = await ftPagedDateWindow<FakeRow>(
      new Date(2026, 5, 1),
      new Date(2026, 5, 60),
      { limit: 5, overlapDays: 1, minWindowDays: 1 },
      fetcher,
      (r) => r.id
    );
    // The first call should trigger shrink; subsequent calls drain.
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
    expect(out.rows.length).toBeGreaterThan(0);
  });

  it("deduplicates rows that appear across multiple windows after a shrink", async () => {
    let callCount = 0;
    const fetcher = vi.fn(async () => {
      callCount += 1;
      // Force a shrink: first call returns exactly limit rows including 'x'.
      // Subsequent calls also include 'x' so dedup must collapse it.
      if (callCount === 1) {
        return Array.from({ length: 5 }, (_, i) => ({
          id: i === 0 ? "x" : `o${i}`,
          modifiedOn: new Date(2026, 5, 1 + i),
        }));
      }
      return [{ id: "x", modifiedOn: new Date(2026, 5, 10) }];
    });
    const out = await ftPagedDateWindow<FakeRow>(
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      { limit: 5, minWindowDays: 1 },
      fetcher,
      (r) => r.id
    );
    const ids = out.rows.map((r) => r.id);
    // 'x' must only appear once even though it was returned multiple times.
    expect(ids.filter((id) => id === "x").length).toBe(1);
  });

  it("handles a zero-row window without infinite-looping", async () => {
    const fetcher = vi.fn(async () => [] as FakeRow[]);
    const out = await ftPagedDateWindow<FakeRow>(
      new Date(2026, 5, 1),
      new Date(2026, 5, 2),
      { limit: 100 },
      fetcher,
      (r) => r.id
    );
    expect(out.rows.length).toBe(0);
    expect(out.calls).toBeGreaterThan(0);
  });
});
