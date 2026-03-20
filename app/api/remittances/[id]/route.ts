import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  return NextResponse.json({
    remittance,
    lineItems: lineItemsResult.data ?? [],
    charges: chargesResult.data ?? [],
  });
}
