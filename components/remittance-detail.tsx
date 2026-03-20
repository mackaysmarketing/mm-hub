"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const CUSTOMER_COLORS: Record<string, string> = {
  Coles: "#E50016",
  Woolworths: "#125B3C",
  ALDI: "#001E5E",
};

function getCustomerColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, color] of Object.entries(CUSTOMER_COLORS)) {
    if (lower.includes(key.toLowerCase())) return color;
  }
  return "#6B6760";
}

function fmtCurrency(v: number): string {
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface Remittance {
  id: string;
  rcti_ref: string;
  payment_date: string | null;
  grower_name: string | null;
  grower_abn: string | null;
  total_gross: number | null;
  total_deductions_ex_gst: number | null;
  total_deductions_gst: number | null;
  total_deductions: number | null;
  total_invoiced: number | null;
  total_quantity: number | null;
  netsuite_pdf_url: string | null;
  status: string | null;
}

interface LineItem {
  id: string;
  sale_date: string | null;
  dispatch_date: string | null;
  product: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  customer: string | null;
  produce_category: string | null;
  grade: string | null;
}

interface Charge {
  id: string;
  charge_type: string | null;
  ex_gst: number | null;
  gst: number | null;
  total_amount: number | null;
}

interface RemittanceDetailResponse {
  remittance: Remittance;
  lineItems: LineItem[];
  charges: Charge[];
}

interface RemittanceDetailProps {
  remittanceId: string;
}

export function RemittanceDetail({ remittanceId }: RemittanceDetailProps) {
  const { data, isLoading } = useQuery<RemittanceDetailResponse>({
    queryKey: ["remittance-detail", remittanceId],
    queryFn: () =>
      fetch(`/api/remittances/${remittanceId}`).then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[120px]" />
      </div>
    );
  }

  if (!data?.remittance) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-stone">
        Remittance not found
      </div>
    );
  }

  const { remittance: rem, lineItems, charges } = data;

  const lineTotalQty = lineItems.reduce(
    (s, r) => s + Number(r.quantity ?? 0),
    0
  );
  const lineTotalAmount = lineItems.reduce(
    (s, r) => s + Number(r.total_amount ?? 0),
    0
  );
  const chargeTotalExGst = charges.reduce(
    (s, r) => s + Number(r.ex_gst ?? 0),
    0
  );
  const chargeTotalGst = charges.reduce(
    (s, r) => s + Number(r.gst ?? 0),
    0
  );
  const chargeTotalAmount = charges.reduce(
    (s, r) => s + Number(r.total_amount ?? 0),
    0
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-xl font-bold text-soil">
            {rem.rcti_ref || "—"}
          </h2>
          <StatusBadge status={rem.status} />
        </div>
        <p className="mt-1 text-sm text-stone">
          Payment date: {fmtDate(rem.payment_date)}
        </p>
        {rem.netsuite_pdf_url && (
          <a
            href={rem.netsuite_pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-sand px-3 py-1.5 text-xs font-medium text-bark transition-colors hover:bg-cream"
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </a>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Gross Sales"
          value={fmtCurrency(Number(rem.total_gross ?? 0))}
          color="text-soil"
        />
        <SummaryCard
          label="Deductions"
          value={fmtCurrency(Number(rem.total_deductions ?? 0))}
          color="text-blaze"
        />
        <SummaryCard
          label="GST on Deductions"
          value={fmtCurrency(Number(rem.total_deductions_gst ?? 0))}
          color="text-bark"
        />
        <SummaryCard
          label="Net Payable"
          value={fmtCurrency(Number(rem.total_invoiced ?? 0))}
          color="text-canopy"
          large
        />
      </div>

      {/* Line Items Table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-soil">Sale lines</h3>
        <Table>
          <TableHeader>
            <TableRow className="border-sand">
              <TableHead className="text-xs text-stone">Date</TableHead>
              <TableHead className="text-xs text-stone">Product</TableHead>
              <TableHead className="text-xs text-stone">Customer</TableHead>
              <TableHead className="text-right text-xs text-stone">
                Qty
              </TableHead>
              <TableHead className="text-right text-xs text-stone">
                $/unit
              </TableHead>
              <TableHead className="text-right text-xs text-stone">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-stone"
                >
                  No line items
                </TableCell>
              </TableRow>
            ) : (
              lineItems.map((line, i) => (
                <TableRow
                  key={line.id}
                  className={i % 2 === 1 ? "bg-cream/40" : "bg-warmwhite"}
                >
                  <TableCell className="text-xs text-bark">
                    {fmtDate(line.sale_date)}
                  </TableCell>
                  <TableCell className="text-xs text-bark">
                    {line.product ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: getCustomerColor(
                            line.customer ?? ""
                          ),
                        }}
                      />
                      <span className="text-bark">
                        {line.customer ?? "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {Number(line.quantity ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {fmtCurrency(Number(line.unit_price ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {fmtCurrency(Number(line.total_amount ?? 0))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {lineItems.length > 0 && (
            <TableFooter className="border-sand bg-parchment/50">
              <TableRow>
                <TableCell colSpan={3} className="text-xs font-medium text-soil">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium text-soil">
                  {lineTotalQty.toLocaleString()}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-mono text-xs font-medium text-soil">
                  {fmtCurrency(lineTotalAmount)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {/* Charges Table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-soil">Deductions</h3>
        <Table>
          <TableHeader>
            <TableRow className="border-sand">
              <TableHead className="text-xs text-stone">Type</TableHead>
              <TableHead className="text-right text-xs text-stone">
                Ex GST
              </TableHead>
              <TableHead className="text-right text-xs text-stone">
                GST
              </TableHead>
              <TableHead className="text-right text-xs text-stone">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-6 text-center text-sm text-stone"
                >
                  No deductions
                </TableCell>
              </TableRow>
            ) : (
              charges.map((charge, i) => (
                <TableRow
                  key={charge.id}
                  className={i % 2 === 1 ? "bg-cream/40" : "bg-warmwhite"}
                >
                  <TableCell className="text-xs text-bark">
                    {charge.charge_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {fmtCurrency(Number(charge.ex_gst ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {fmtCurrency(Number(charge.gst ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-bark">
                    {fmtCurrency(Number(charge.total_amount ?? 0))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {charges.length > 0 && (
            <TableFooter className="border-sand bg-parchment/50">
              <TableRow>
                <TableCell className="text-xs font-medium text-soil">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium text-soil">
                  {fmtCurrency(chargeTotalExGst)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium text-soil">
                  {fmtCurrency(chargeTotalGst)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium text-soil">
                  {fmtCurrency(chargeTotalAmount)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  large,
}: {
  label: string;
  value: string;
  color: string;
  large?: boolean;
}) {
  return (
    <div className="rounded-lg border border-sand bg-warmwhite p-3">
      <p className="text-xs text-stone">{label}</p>
      <p
        className={`mt-1 font-mono font-bold ${color} ${
          large ? "text-lg" : "text-sm"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  let classes = "rounded-full px-2 py-0.5 text-xs font-medium ";
  if (s === "processed") {
    classes += "bg-canopy/10 text-canopy";
  } else if (s === "pending") {
    classes += "bg-harvest/20 text-harvest";
  } else if (s === "failed") {
    classes += "bg-blaze/10 text-blaze";
  } else {
    classes += "bg-sand text-bark";
  }
  return <span className={classes}>{status ?? "—"}</span>;
}
