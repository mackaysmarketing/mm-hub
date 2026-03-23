import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalAccessContext, getGrowerFilter } from "@/lib/portal-access";
import { stripFinancials } from "@/lib/financial-filter";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const accessCtx = await getPortalAccessContext();
  const growerFilter = getGrowerFilter(accessCtx);

  const supabase = createClient();

  // Fetch remittance header
  const { data: remittance, error: remError } = await supabase
    .from("remittances")
    .select("*")
    .eq("id", params.id)
    .single();

  if (remError || !remittance) {
    return NextResponse.json(
      { error: remError?.message ?? "Remittance not found" },
      { status: 404 }
    );
  }

  // Verify user has access to this remittance's grower
  if (growerFilter && !growerFilter.includes(remittance.grower_id)) {
    return NextResponse.json(
      { error: "Not authorized to view this remittance" },
      { status: 403 }
    );
  }

  // Fetch line items and charges in parallel
  const [lineItemsResult, chargesResult] = await Promise.all([
    supabase
      .from("remittance_line_items")
      .select("*")
      .eq("remittance_id", params.id)
      .order("sale_date", { ascending: true }),
    supabase
      .from("remittance_charges")
      .select("*")
      .eq("remittance_id", params.id)
      .order("charge_type", { ascending: true }),
  ]);

  let result = {
    remittance,
    lineItems: lineItemsResult.data ?? [],
    charges: chargesResult.data ?? [],
  };

  // Apply financial access filtering
  if (accessCtx.financialAccess["Remittances"] === false) {
    result = stripFinancials(result);
  }

  return NextResponse.json(result);
}
