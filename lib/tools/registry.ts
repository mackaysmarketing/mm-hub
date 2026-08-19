/**
 * The Tools catalogue, and which tools are access-gated.
 *
 * Tools were originally visible to every internal user. Some now handle
 * commercially sensitive material — retailer quote pricing being the first —
 * and need to be narrowed to named people without minting a new module role
 * per tool. A tool listed with `gated: true` is visible only to hub_admins and
 * to users holding a `tool_access` row for its key; anything else stays open to
 * all internal users, so adding this did not change who can see the tools that
 * already existed.
 */
export interface ToolDefinition {
  key: string;
  href: string;
  name: string;
  description: string;
  /** true = requires an explicit grant (or hub_admin). */
  gated: boolean;
}

export const TOOLS: ToolDefinition[] = [
  {
    key: "consignor_auto_assign",
    href: "/tools/consignor-auto-assign",
    name: "Auto FT Consignor Update",
    description:
      "Fills a blank consignor on newly-arrived FreshTrack orders for known customers, per an admin-managed mapping.",
    gated: false,
  },
  {
    key: "retailer_price_verification",
    href: "/tools/price-verification",
    name: "Retailer Price Verification",
    description:
      "Checks FreshTrack order prices against the weekly Coles and Woolworths quote extracts, line by line, and reports every match, mismatch and gap.",
    gated: true,
  },
];

export function getTool(key: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.key === key);
}
