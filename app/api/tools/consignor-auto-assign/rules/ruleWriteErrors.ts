/**
 * Plain-English answers for the database's rule constraints, shared by POST
 * and PATCH. buildRuleRows catches all of these first; this is the backstop
 * if a request ever gets past it.
 */
import { NextResponse } from "next/server";

export function ruleWriteErrorResponse(error: { code?: string; message: string }) {
  // 23505 = unique_violation on consignor_rules_uniq.
  if (error.code === "23505") {
    return NextResponse.json(
      {
        error:
          "An active rule already exists for this customer with this crop or product. Edit or delete that rule first.",
      },
      { status: 409 }
    );
  }
  // 23514 = check_violation: not_fully_wildcard, crop_or_product, action_consignor.
  if (error.code === "23514") {
    return NextResponse.json(
      {
        error:
          "That rule isn't valid: it needs a customer, a crop or a product (not a crop and a product together), and a consignor unless it is 'leave blank'.",
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
