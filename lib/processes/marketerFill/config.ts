/**
 * marketer_auto_fill config: defaults, a forgiving reader for the runner, and
 * a strict validator for the settings PATCH. Pure — no server-only imports —
 * so the Tools page can show the same defaults the runner uses.
 */
import { parseSchedule } from "../schedule";

export const MARKETER_PROCESS_KEY = "marketer_auto_fill";

export interface MarketerFillConfig {
  schedule: { frequency: string; n?: number; at_hour_brisbane?: number };
  /** FreshTrack order-state codes the fill may act on. */
  assignable_state_codes: string[];
  /** Parent customer entity codes; every customer under them is in scope. */
  customer_group_codes: string[];
  /** The marketer to write, by entity code (role id resolved live). */
  marketer_entity_code: string;
  discovery_lookback_days: number;
  discovery_horizon_days: number;
}

/**
 * WOWGL is Woolworths Head Office, the parent of all nine Woolworths DCs.
 * The 120-day lookback reaches the oldest open blank-marketer PO on
 * 30 Oct 2026 (delivery 24 Jul), so the first run also clears the backlog.
 */
export const MARKETER_DEFAULTS: MarketerFillConfig = {
  schedule: { frequency: "every_n_minutes", n: 5 },
  assignable_state_codes: ["OR", "FORD", "Default"],
  customer_group_codes: ["WOWGL"],
  marketer_entity_code: "MACKM",
  discovery_lookback_days: 120,
  discovery_horizon_days: 60,
};

const MAX_WINDOW_DAYS = 400;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const codeList = (v: string[]) =>
  Array.from(new Set(v.map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0)));

const isDays = (v: unknown, min: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= MAX_WINDOW_DAYS;

/** For the runner: stored values where usable, defaults where not. Never throws. */
export function readMarketerConfig(raw: unknown): MarketerFillConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    schedule: parseSchedule(c.schedule)
      ? (c.schedule as MarketerFillConfig["schedule"])
      : MARKETER_DEFAULTS.schedule,
    assignable_state_codes: isStringArray(c.assignable_state_codes)
      ? c.assignable_state_codes
      : MARKETER_DEFAULTS.assignable_state_codes,
    customer_group_codes: isStringArray(c.customer_group_codes)
      ? c.customer_group_codes
      : MARKETER_DEFAULTS.customer_group_codes,
    marketer_entity_code:
      typeof c.marketer_entity_code === "string" && c.marketer_entity_code.trim()
        ? c.marketer_entity_code
        : MARKETER_DEFAULTS.marketer_entity_code,
    discovery_lookback_days: isDays(c.discovery_lookback_days, 0)
      ? c.discovery_lookback_days
      : MARKETER_DEFAULTS.discovery_lookback_days,
    discovery_horizon_days: isDays(c.discovery_horizon_days, 1)
      ? c.discovery_horizon_days
      : MARKETER_DEFAULTS.discovery_horizon_days,
  };
}

/**
 * For the settings PATCH: the whole config must be sound, and comes back
 * tidied (codes trimmed, upper-cased, de-duplicated; unknown keys dropped).
 * An empty state list is allowed — it simply fills nothing.
 */
export function validateMarketerConfig(
  raw: unknown
): { ok: true; config: MarketerFillConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Config must be an object." };
  }
  const c = raw as Record<string, unknown>;

  if (!parseSchedule(c.schedule)) return { ok: false, error: "Invalid schedule." };
  if (!isStringArray(c.assignable_state_codes)) {
    return { ok: false, error: "Order states must be a list of state codes." };
  }
  if (!isStringArray(c.customer_group_codes) || codeList(c.customer_group_codes).length === 0) {
    return { ok: false, error: "Give at least one customer group code, e.g. WOWGL." };
  }
  if (typeof c.marketer_entity_code !== "string" || !c.marketer_entity_code.trim()) {
    return { ok: false, error: "Give the marketer's code, e.g. MACKM." };
  }
  if (!isDays(c.discovery_lookback_days, 0)) {
    return { ok: false, error: `Look-back must be a whole number of days, 0 to ${MAX_WINDOW_DAYS}.` };
  }
  if (!isDays(c.discovery_horizon_days, 1)) {
    return { ok: false, error: `Look-ahead must be a whole number of days, 1 to ${MAX_WINDOW_DAYS}.` };
  }

  return {
    ok: true,
    config: {
      schedule: c.schedule as MarketerFillConfig["schedule"],
      assignable_state_codes: Array.from(new Set(c.assignable_state_codes.map((s) => s.trim()).filter(Boolean))),
      customer_group_codes: codeList(c.customer_group_codes),
      marketer_entity_code: c.marketer_entity_code.trim().toUpperCase(),
      discovery_lookback_days: c.discovery_lookback_days,
      discovery_horizon_days: c.discovery_horizon_days,
    },
  };
}
