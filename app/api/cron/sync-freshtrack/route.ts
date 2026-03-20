import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryFreshTrack } from "@/lib/freshtrack";
import {
  chunkArray,
  mapSourceRow,
  applyTransforms,
  type SyncStepResult,
} from "@/lib/sync-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for Vercel Pro

// ---------------------------------------------------------------------------
// GET /api/cron/sync-freshtrack
// Vercel Cron handler — runs every 15 minutes
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const startTime = Date.now();

  // a. Validate CRON_SECRET (skip in development)
  if (process.env.NODE_ENV !== "development") {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const steps: SyncStepResult[] = [];
  let syncLogId: string | null = null;

  try {
    // b. Create sync_log entry (status: 'running')
    const { data: logEntry, error: logError } = await supabase
      .from("sync_logs")
      .insert({
        source: "freshtrack",
        sync_type: "full",
        status: "running",
      })
      .select("id")
      .single();

    if (logError) throw new Error(`Failed to create sync log: ${logError.message}`);
    syncLogId = logEntry.id;

    // c. Load enabled sync_config rows for freshtrack
    const { data: syncConfigs, error: configError } = await supabase
      .from("sync_config")
      .select("*")
      .eq("sync_source", "freshtrack")
      .eq("enabled", true)
      .order("step_order", { ascending: true });

    if (configError) throw new Error(`Failed to load sync config: ${configError.message}`);
    if (!syncConfigs || syncConfigs.length === 0) {
      throw new Error("No enabled FreshTrack sync configs found");
    }

    // d. Load grower lookup map: freshtrack_code → grower uuid
    const { data: growers } = await supabase
      .from("growers")
      .select("id, freshtrack_code");

    const growerMap = new Map<string, string>();
    if (growers) {
      for (const g of growers) {
        if (g.freshtrack_code) {
          growerMap.set(g.freshtrack_code, g.id);
        }
      }
    }

    // e. Process each enabled sync step
    for (const config of syncConfigs) {
      const stepResult: SyncStepResult = {
        step: config.step_order,
        sourceView: config.source_view,
        targetTable: config.target_table,
        recordsSynced: 0,
      };

      try {
        // Query FreshTrack source view
        const sourceRows = await queryFreshTrack(
          `SELECT * FROM ${config.source_view}`
        );

        const fieldMapping = config.field_mapping as Record<string, string>;
        const transformRules = config.transform_rules as Record<string, string>;
        const growerResolveField = config.grower_resolve_field as string | null;
        const dedupColumn = config.dedup_column as string;

        // Transform rows
        const mappedRows = sourceRows.map((sourceRow) => {
          // Apply field mapping
          let row = mapSourceRow(sourceRow, fieldMapping);

          // Apply transform rules
          row = applyTransforms(row, transformRules);

          // Resolve grower_id if applicable
          if (growerResolveField) {
            const entityCode = String(sourceRow[growerResolveField] ?? "");
            row.grower_id = growerMap.get(entityCode) ?? null;
          }

          // Add sync timestamp
          row.synced_at = new Date().toISOString();

          return row;
        });

        // Batch upsert in chunks of 500
        const chunks = chunkArray(mappedRows, 500);
        let totalUpserted = 0;

        for (const chunk of chunks) {
          const { error: upsertError, count } = await supabase
            .from(config.target_table)
            .upsert(chunk, { onConflict: dedupColumn, count: "exact" });

          if (upsertError) {
            throw new Error(
              `Upsert failed for ${config.target_table}: ${upsertError.message}`
            );
          }
          totalUpserted += count ?? chunk.length;
        }

        stepResult.recordsSynced = totalUpserted;
      } catch (err) {
        stepResult.error =
          err instanceof Error ? err.message : "Unknown step error";
      }

      steps.push(stepResult);
    }
  } catch (err) {
    // Top-level error — still update the sync log
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    if (syncLogId) {
      await supabase
        .from("sync_logs")
        .update({
          status: "failed",
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", syncLogId);
    }
    return NextResponse.json(
      { status: "failed", error: errorMsg },
      { status: 500 }
    );
  }

  // f. Update sync_log with results
  const totalRecords = steps.reduce((sum, s) => sum + s.recordsSynced, 0);
  const stepErrors = steps
    .filter((s) => s.error)
    .map((s) => `Step ${s.step} (${s.targetTable}): ${s.error}`);
  const hasErrors = stepErrors.length > 0;
  const duration = Date.now() - startTime;

  if (syncLogId) {
    await supabase
      .from("sync_logs")
      .update({
        status: hasErrors ? "failed" : "success",
        records_synced: totalRecords,
        error_message: hasErrors ? stepErrors.join("; ") : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", syncLogId);
  }

  // g. Return JSON response
  return NextResponse.json({
    status: hasErrors ? "partial" : "success",
    steps,
    totalRecords,
    duration,
  });
}
