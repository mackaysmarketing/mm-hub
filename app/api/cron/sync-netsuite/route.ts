import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { netsuiteClient } from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for Vercel Pro

// ---------------------------------------------------------------------------
// ⚠️  IMPORTANT: The NetSuite field names used throughout this handler are
//     ESTIMATES based on standard vendorBill schema. The actual field names,
//     sublist structure, and RCTI record type MUST be verified against the
//     real NetSuite sandbox. Update the sync_config mappings and this handler
//     once confirmed by the Mackays finance team.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/cron/sync-netsuite
// Vercel Cron handler — runs every 30 minutes
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
  let syncLogId: string | null = null;
  let recordsSynced = 0;
  const errors: string[] = [];

  try {
    // b. Create sync_log entry (status: 'running')
    const { data: logEntry, error: logError } = await supabase
      .from("sync_logs")
      .insert({
        source: "netsuite",
        sync_type: "incremental",
        status: "running",
      })
      .select("id")
      .single();

    if (logError)
      throw new Error(`Failed to create sync log: ${logError.message}`);
    syncLogId = logEntry.id;

    // c. Get last successful netsuite sync timestamp
    const { data: lastSync } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .eq("source", "netsuite")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    const lastSyncDate = lastSync?.completed_at ?? undefined;

    // d. Load grower lookup map: freshtrack_code → grower uuid
    //    NetSuite entity codes map via the same grower.freshtrack_code field
    const { data: growers } = await supabase
      .from("growers")
      .select("id, freshtrack_code, name, abn");

    const growerByCode = new Map<
      string,
      { id: string; name: string; abn: string | null }
    >();
    if (growers) {
      for (const g of growers) {
        if (g.freshtrack_code) {
          growerByCode.set(g.freshtrack_code, {
            id: g.id,
            name: g.name,
            abn: g.abn,
          });
        }
      }
    }

    // e. Fetch new/updated RCTIs from NetSuite
    const rctiList = await netsuiteClient.searchRCTIs(lastSyncDate);

    // f. Process each RCTI record
    for (const rctiSummary of rctiList) {
      try {
        // Fetch full detail with line items and charges expanded
        const internalId = String(rctiSummary.id ?? rctiSummary.internalId ?? "");
        if (!internalId) {
          errors.push("Skipped RCTI with missing internalId");
          continue;
        }

        const rcti = await netsuiteClient.getRCTIDetail(internalId);

        // ⚠️ BEST GUESS: These field names are based on standard NetSuite
        //    vendorBill schema. Verify with real API response.
        const netsuiteId = String(rcti.internalId ?? rcti.id ?? "");
        const rctiRef = String(rcti.tranId ?? "");
        const paymentDate = rcti.tranDate
          ? String(rcti.tranDate)
          : null;

        // Resolve grower from entity field
        // ⚠️ TBC: The entity field structure in NetSuite — could be
        //    entity.id, entity.entityId, entity.companyName, or entity.value
        const entityField = rcti.entity as
          | Record<string, unknown>
          | string
          | undefined;
        const entityCode =
          typeof entityField === "string"
            ? entityField
            : String(
                entityField?.entityId ??
                  entityField?.id ??
                  entityField?.value ??
                  ""
              );

        const growerInfo = growerByCode.get(entityCode);
        if (!growerInfo) {
          errors.push(
            `RCTI ${rctiRef}: could not resolve grower for entity "${entityCode}"`
          );
          continue;
        }

        // ⚠️ BEST GUESS: Financial totals field names
        const totalGross = Number(rcti.total ?? 0);
        // NetSuite may split deductions differently — these fields are estimates
        const totalDeductionsExGst = Number(
          rcti.totalDeductionsExGst ?? rcti.expenseTotal ?? 0
        );
        const totalDeductionsGst = Number(
          rcti.totalDeductionsGst ?? rcti.taxTotal ?? 0
        );
        const totalDeductions = totalDeductionsExGst + totalDeductionsGst;
        const totalInvoiced = Number(
          rcti.totalInvoiced ?? rcti.balance ?? totalGross - totalDeductions
        );
        const totalQuantity = Number(rcti.quantity ?? 0);

        // ⚠️ TBC: PDF URL generation — NetSuite may expose a direct PDF link
        //    or require a separate file cabinet call
        const netsuitePdfUrl = rcti.pdfUrl
          ? String(rcti.pdfUrl)
          : null;

        // UPSERT remittance header
        const { data: remittance, error: remittanceError } = await supabase
          .from("remittances")
          .upsert(
            {
              netsuite_id: netsuiteId,
              grower_id: growerInfo.id,
              rcti_ref: rctiRef,
              payment_date: paymentDate,
              grower_name: growerInfo.name,
              grower_abn: growerInfo.abn,
              total_gross: totalGross,
              total_deductions_ex_gst: totalDeductionsExGst,
              total_deductions_gst: totalDeductionsGst,
              total_deductions: totalDeductions,
              total_invoiced: totalInvoiced,
              total_quantity: totalQuantity,
              netsuite_pdf_url: netsuitePdfUrl,
              status: "processed",
              synced_at: new Date().toISOString(),
            },
            { onConflict: "netsuite_id" }
          )
          .select("id")
          .single();

        if (remittanceError) {
          errors.push(
            `RCTI ${rctiRef}: remittance upsert failed — ${remittanceError.message}`
          );
          continue;
        }

        const remittanceId = remittance.id;

        // --- Line items ---
        // Delete existing line items (cascade-safe since we have the remittance_id)
        // then reinsert from the NetSuite response
        await supabase
          .from("remittance_line_items")
          .delete()
          .eq("remittance_id", remittanceId);

        // ⚠️ BEST GUESS: Line items sublist name and field structure
        //    Standard vendorBill uses "item" sublist, but Mackays may use
        //    a custom sublist. Verify with real API response.
        const lineItems = (rcti.item as { items?: Record<string, unknown>[] })
          ?.items ?? [];

        if (lineItems.length > 0) {
          const lineRows = lineItems.map((line) => ({
            remittance_id: remittanceId,
            netsuite_line_id: String(line.line ?? line.lineId ?? ""),
            // ⚠️ BEST GUESS field mappings — verify with real NetSuite data
            sale_date: line.saleDate ?? line.custcol_sale_date ?? null,
            dispatch_date:
              line.dispatchDate ?? line.custcol_dispatch_date ?? null,
            origin_load:
              String(line.originLoad ?? line.custcol_origin_load ?? ""),
            destination: String(
              line.destination ?? line.custcol_destination ?? ""
            ),
            po_number: String(line.purchaseOrder ?? line.poNum ?? ""),
            manifest: String(line.manifest ?? line.custcol_manifest ?? ""),
            customer_ref: String(
              line.customerRef ?? line.custcol_customer_ref ?? ""
            ),
            consignee_code: String(
              line.consigneeCode ?? line.custcol_consignee_code ?? ""
            ),
            product: String(
              line.item_display ?? line.description ?? line.item ?? ""
            ),
            description: String(line.description ?? line.memo ?? ""),
            quantity: Number(line.quantity ?? 0),
            unit_price: Number(line.rate ?? line.unitPrice ?? 0),
            total_amount: Number(line.amount ?? 0),
            customer: String(line.customer ?? line.custcol_customer ?? ""),
            produce_category: String(
              line.produceCategory ?? line.custcol_produce_category ?? ""
            ),
            grade: String(line.grade ?? line.custcol_grade ?? ""),
          }));

          const { error: lineError } = await supabase
            .from("remittance_line_items")
            .insert(lineRows);

          if (lineError) {
            errors.push(
              `RCTI ${rctiRef}: line items insert failed — ${lineError.message}`
            );
          }
        }

        // --- Charges ---
        await supabase
          .from("remittance_charges")
          .delete()
          .eq("remittance_id", remittanceId);

        // ⚠️ BEST GUESS: Charges may come from "expense" sublist on vendorBill
        //    or a custom sublist. Verify with real API response.
        const charges = (
          rcti.expense as { items?: Record<string, unknown>[] }
        )?.items ?? [];

        if (charges.length > 0) {
          const chargeRows = charges.map((charge) => ({
            remittance_id: remittanceId,
            charge_type: String(
              charge.category ?? charge.account_display ?? charge.memo ?? ""
            ),
            ex_gst: Number(charge.amount ?? 0),
            gst: Number(charge.tax1Amt ?? charge.taxAmount ?? 0),
            total_amount:
              Number(charge.amount ?? 0) +
              Number(charge.tax1Amt ?? charge.taxAmount ?? 0),
          }));

          const { error: chargeError } = await supabase
            .from("remittance_charges")
            .insert(chargeRows);

          if (chargeError) {
            errors.push(
              `RCTI ${rctiRef}: charges insert failed — ${chargeError.message}`
            );
          }
        }

        recordsSynced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        const ref = String(rctiSummary.tranId ?? rctiSummary.id ?? "?");
        errors.push(`RCTI ${ref}: ${msg}`);
      }
    }
  } catch (err) {
    // Top-level error
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

  // g. Update sync_log with results
  const hasErrors = errors.length > 0;
  const duration = Date.now() - startTime;

  if (syncLogId) {
    await supabase
      .from("sync_logs")
      .update({
        status: hasErrors ? "failed" : "success",
        records_synced: recordsSynced,
        error_message: hasErrors ? errors.join("; ") : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", syncLogId);
  }

  // h. Return JSON summary
  return NextResponse.json({
    status: hasErrors ? "partial" : "success",
    recordsSynced,
    errors: hasErrors ? errors : undefined,
    duration,
  });
}
