/**
 * Step 5: chargesApplied window sync. ChargeAppliedNode is the ONE FT node
 * that exposes `lastModifiedOn` as a selectable field — so per-row we can
 * store source_modified_on and the cursor advances using the FT row's own
 * timestamp.
 *
 * Window is on appliedOn for the user-facing date filter; the per-row
 * modifiedOn captures retroactive edits we'd otherwise miss with appliedOn
 * alone.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gqlQuery } from "@/lib/freshtrack-graphql";
import {
  Q_CHARGES_APPLIED_WINDOW,
  type RspChargesApplied,
  type FTChargeApplied,
} from "@/lib/freshtrack/queries";
import {
  getWatermark,
  advanceWatermark,
  markStepStarted,
  recordStepFailure,
  type FtSyncEntityType,
} from "./cursor";

const STEP: FtSyncEntityType = "chargesApplied";
const DEFAULT_LOOKBACK_DAYS = 30;
const RECURRING_LOOKBACK_DAYS = 14;
const FT_LIMIT = 5_000;

export interface ChargeSyncResult {
  rowsUpserted: number;
  rowsSeen: number;
  graphqlCalls: number;
  windowStart: Date;
  windowEnd: Date;
}

export async function syncCharges(): Promise<ChargeSyncResult> {
  const runStart = new Date();
  await markStepStarted(STEP);
  try {
    const watermark = await getWatermark(STEP);
    const windowStart = computeWindowStart(watermark, runStart);
    const windowEnd = runStart;

    const res = await gqlQuery<RspChargesApplied>(Q_CHARGES_APPLIED_WINDOW, {
      limit: FT_LIMIT,
      appliedStart: windowStart.toISOString(),
      appliedEnd: windowEnd.toISOString(),
    });
    const charges = res.chargesApplied;

    const rowsUpserted = await upsertCharges(charges);

    await advanceWatermark(STEP, runStart, {
      rowsUpserted,
      rowsSeen: charges.length,
    });

    return {
      rowsUpserted,
      rowsSeen: charges.length,
      graphqlCalls: 1,
      windowStart,
      windowEnd,
    };
  } catch (err) {
    await recordStepFailure(STEP, err);
    throw err;
  }
}

function computeWindowStart(watermark: Date | null, now: Date): Date {
  const ms = (watermark
    ? RECURRING_LOOKBACK_DAYS
    : DEFAULT_LOOKBACK_DAYS) * 86_400_000;
  return new Date(now.getTime() - ms);
}

async function upsertCharges(charges: FTChargeApplied[]): Promise<number> {
  if (charges.length === 0) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const payload = charges.map((c) => ({
    freshtrack_id: c.id,
    text1: c.text1 || null,
    text2: c.text2 || null,
    text3: c.text3 || null,
    account_code: c.accountCode || null,
    reference: c.reference || null,
    quantity_value: c.quantityValue,
    quantity_unit: c.quantityUnit || null,
    amount_value: c.amountValue,
    amount_currency: c.amountCurrency || null,
    total_amount_value: c.totalAmountValue,
    total_amount_currency: c.totalAmountCurrency || null,
    applied_on: c.appliedOn,
    is_deductible: c.isDeductible,
    is_active: c.isActive,
    source_created_on: c.createdOn,
    source_modified_on: c.lastModifiedOn, // the one node that exposes this
    // Legacy compat from migration 00001:
    charge_type: c.text1 || null,
    description: [c.text1, c.text2, c.text3].filter(Boolean).join(" - ") || null,
    raw_json: c,
    synced_at: now,
  }));

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error } = await admin
      .from("ft_charges")
      .upsert(slice, { onConflict: "freshtrack_id" });
    if (error) throw new Error(`ft_charges upsert chunk ${i}: ${error.message}`);
    upserted += slice.length;
  }
  return upserted;
}
