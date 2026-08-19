"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  PlayCircle,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { PanelError } from "@/components/panel-error";
import { safeFetch } from "@/lib/portal-constants";

const BASE = "/api/tools/price-verification";

// ---------------------------------------------------------------- types

interface QuoteFile {
  id: string;
  retailer: "coles" | "woolworths";
  file_name: string;
  period_start: string;
  period_end: string;
  line_count: number;
  row_count: number;
  parse_warnings: { row: number; reason: string; sample?: string }[];
  created_at: string;
  latestRun: RunRow | null;
}

interface RunRow {
  id: string;
  quote_file_id: string;
  status: "running" | "success" | "failed";
  started_at: string;
  completed_at: string | null;
  orders_total: number;
  orders_verified: number;
  orders_mismatched: number;
  orders_partial: number;
  orders_no_quote: number;
  orders_skipped: number;
  orders_unmapped: number;
  orders_duplicate: number;
  lines_total: number;
  lines_matched: number;
  lines_mismatched: number;
  lines_no_quote: number;
  coverage: { covered: boolean; warning: string | null } | null;
  settings: Record<string, unknown> | null;
  error: string | null;
}

interface OrderRow {
  id: string;
  order_no: string | null;
  order_state: string | null;
  consignee_code: string | null;
  consignee_name: string | null;
  dc_code: string | null;
  delivery_date: string | null;
  outcome: string;
  reason: string | null;
  is_duplicate: boolean;
  duplicate_group: string | null;
  lines_total: number;
  lines_matched: number;
  lines_mismatched: number;
  lines_no_quote: number;
}

interface LineRow {
  id: string;
  order_row_id: string;
  line_no: number | null;
  item_no: string | null;
  description: string | null;
  quantity: number | null;
  order_price: string | number | null;
  price_per: string | null;
  quote_price: string | number | null;
  variance: string | number | null;
  outcome: string;
  detail: string | null;
}

interface ReportResponse {
  run: RunRow;
  quoteFile: {
    retailer: string;
    file_name: string;
    period_start: string;
    period_end: string;
  } | null;
  orders: OrderRow[];
  lines: LineRow[];
}

interface Settings {
  tolerance: number;
  verifiableStates: string[];
  skipStates: string[];
  unapprovedQuotes: "use" | "skip";
  writeBackEnabled: boolean;
  updatedAt: string | null;
}

interface DcMapping {
  retailer: "coles" | "woolworths";
  dcCode: string;
  dcLabel: string | null;
  entityCode: string | null;
  altEntityCodes: string[];
  active: boolean;
  notes: string | null;
}

interface DcMapResponse {
  mappings: DcMapping[];
  entities: { code: string; name: string }[];
}

interface AccessUser {
  id: string;
  name: string;
  email: string;
  hubRole: string;
  moduleRole: string | null;
  alwaysAllowed: boolean;
  hasAccess: boolean;
  grantedAt: string | null;
}

// ---------------------------------------------------------------- helpers

async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? `Request failed: ${res.status}`);
  return payload as T;
}

function money(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return `$${Number(v).toFixed(2)}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

const OUTCOME_LABELS: Record<string, string> = {
  verified: "Verified",
  mismatch: "Mismatch",
  partial: "Partly checked",
  no_quote: "No quote",
  skipped: "Skipped",
  unmapped: "DC not mapped",
};

const LINE_OUTCOME_LABELS: Record<string, string> = {
  match: "Match",
  mismatch: "Mismatch",
  no_quote: "No quote line",
  quote_unpriced: "Quote has no price",
  quote_unapproved: "Quote not approved",
  no_order_price: "Order has no price",
};

function OutcomeBadge({ outcome }: { outcome: string }) {
  const label = OUTCOME_LABELS[outcome] ?? LINE_OUTCOME_LABELS[outcome] ?? outcome;
  const tone =
    outcome === "verified" || outcome === "match"
      ? "border-canopy/30 bg-canopy/10 text-canopy"
      : outcome === "mismatch"
        ? "border-blaze/30 bg-blaze/10 text-blaze"
        : outcome === "partial"
          ? "border-harvest/40 bg-harvest/10 text-harvest"
          : "border-sand bg-parchment text-stone";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function RetailerBadge({ retailer }: { retailer: string }) {
  // Retailer colours are reserved for retailer-tagged elements — this is one.
  const tone =
    retailer === "coles"
      ? "border-coles/30 bg-coles/10 text-coles"
      : "border-woolworths/30 bg-woolworths/10 text-woolworths";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {retailer === "coles" ? "Coles" : "Woolworths"}
    </span>
  );
}

// ================================================================= page

export function PriceVerificationClient({ isHubAdmin }: { isHubAdmin: boolean }) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [tab, setTab] = useState("quotes");

  return (
    <div className="space-y-6">
      <TopBar title="Retailer Price Verification" />

      <p className="text-sm text-bark">
        Checks FreshTrack order prices against the weekly Coles and Woolworths
        quote extracts, line by line. Read-only — it reports what it finds and
        never changes anything in FreshTrack.
      </p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="quotes">Quotes &amp; runs</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          {isHubAdmin && <TabsTrigger value="access">Access</TabsTrigger>}
        </TabsList>

        <TabsContent value="quotes" className="mt-4">
          <QuotesTab
            onOpenReport={(runId) => {
              setActiveRunId(runId);
              setTab("report");
            }}
          />
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          <ReportTab runId={activeRunId} onPickRun={setActiveRunId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab isHubAdmin={isHubAdmin} />
        </TabsContent>

        {isHubAdmin && (
          <TabsContent value="access" className="mt-4">
            <AccessTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ================================================== tab 1 — quotes & runs

function QuotesTab({ onOpenReport }: { onOpenReport: (runId: string) => void }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const quotes = useQuery<QuoteFile[]>({
    queryKey: ["pv-quotes"],
    queryFn: () => safeFetch(`${BASE}/quotes`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/quotes`, { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as { error?: string }).error ?? "Upload failed");
      return payload as {
        retailer: string;
        periodStart: string;
        periodEnd: string;
        rowCount: number;
        lineCount: number;
        dcCodes: string[];
        warnings: unknown[];
        replacedPrevious: boolean;
      };
    },
    onSuccess: (data) => {
      setUploadError(null);
      setUploadNote(
        `Read ${data.rowCount} ${data.retailer === "coles" ? "Coles" : "Woolworths"} quote ` +
          `rows for ${data.periodStart} to ${data.periodEnd} across ${data.dcCodes.length} DC(s)` +
          (data.replacedPrevious ? " (replaced the previous upload of the same file)." : ".")
      );
      qc.invalidateQueries({ queryKey: ["pv-quotes"] });
    },
    onError: (err: Error) => {
      setUploadNote(null);
      setUploadError(err.message);
    },
  });

  const run = useMutation({
    mutationFn: (quoteFileId: string) =>
      postJson<{ runId: string; coverage: { warning: string | null } }>(`${BASE}/runs`, {
        quoteFileId,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pv-quotes"] });
      onOpenReport(data.runId);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => postJson(`${BASE}/quotes/${id}`, {}, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pv-quotes"] }),
  });

  return (
    <div className="space-y-5">
      {/* upload */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h3 className="text-sm font-semibold text-soil">Upload a quote extract</h3>
        <p className="mt-1 text-xs text-bark">
          The Coles supplier quote sheet (.xlsx) or the Woolworths Weekly PQF
          (.xls). The retailer and the quote week are read from the file
          contents, so the file name does not matter.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xls,.xlsx,.htm,.html"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Choose file
          </Button>
          {uploadNote && <span className="text-xs text-canopy">{uploadNote}</span>}
        </div>

        {uploadError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-blaze/20 bg-blaze/5 p-3 text-xs text-blaze">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* quote list */}
      {quotes.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : quotes.isError ? (
        <PanelError label="Could not load uploaded quotes" />
      ) : quotes.data && quotes.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand bg-warmwhite p-10 text-center">
          <FileSpreadsheet className="mx-auto h-7 w-7 text-clay" />
          <p className="mt-2 text-sm text-bark">No quote files uploaded yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Retailer</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Quote week</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.data?.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <RetailerBadge retailer={q.retailer} />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-soil">{q.file_name}</div>
                    {q.parse_warnings.length > 0 && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-harvest">
                        <AlertTriangle className="h-3 w-3" />
                        {q.parse_warnings.length} row(s) skipped while parsing
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-bark">
                    {q.period_start} → {q.period_end}
                  </TableCell>
                  <TableCell className="text-right text-sm text-bark">
                    {q.row_count}
                  </TableCell>
                  <TableCell className="text-sm">
                    {q.latestRun ? (
                      <RunSummaryInline run={q.latestRun} />
                    ) : (
                      <span className="text-xs text-clay">not run yet</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {q.latestRun?.status === "success" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenReport(q.latestRun!.id)}
                        >
                          Report
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => run.mutate(q.id)}
                        disabled={run.isPending}
                      >
                        {run.isPending && run.variables === q.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Verify
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete quote file"
                        onClick={() => remove.mutate(q.id)}
                      >
                        <Trash2 className="h-4 w-4 text-stone" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {run.isError && <PanelError label={(run.error as Error).message} />}
    </div>
  );
}

function RunSummaryInline({ run }: { run: RunRow }) {
  if (run.status === "failed") {
    return <span className="text-xs text-blaze">failed</span>;
  }
  if (run.status === "running") {
    return <span className="text-xs text-stone">running…</span>;
  }
  return (
    <span className="text-xs text-bark">
      {run.orders_verified}/{run.orders_total} verified
      {run.orders_mismatched > 0 && (
        <span className="ml-1 text-blaze">· {run.orders_mismatched} mismatch</span>
      )}
    </span>
  );
}

// ======================================================== tab 2 — report

function ReportTab({
  runId,
  onPickRun,
}: {
  runId: string | null;
  onPickRun: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runs = useQuery<RunRow[]>({
    queryKey: ["pv-runs"],
    queryFn: () => safeFetch(`${BASE}/runs`),
  });

  const effectiveRunId = runId ?? runs.data?.[0]?.id ?? null;

  const report = useQuery<ReportResponse>({
    queryKey: ["pv-report", effectiveRunId],
    queryFn: () => safeFetch(`${BASE}/runs/${effectiveRunId}`),
    enabled: !!effectiveRunId,
  });

  const detail = useQuery<ReportResponse>({
    queryKey: ["pv-report-order", effectiveRunId, expanded],
    queryFn: () => safeFetch(`${BASE}/runs/${effectiveRunId}?orderRowId=${expanded}`),
    enabled: !!effectiveRunId && !!expanded,
  });

  const linesByOrder = useMemo(() => {
    const map = new Map<string, LineRow[]>();
    for (const l of [...(report.data?.lines ?? []), ...(detail.data?.lines ?? [])]) {
      const bucket = map.get(l.order_row_id) ?? [];
      if (!bucket.some((x) => x.id === l.id)) bucket.push(l);
      map.set(l.order_row_id, bucket);
    }
    return map;
  }, [report.data?.lines, detail.data?.lines]);

  if (runs.isLoading) return <Skeleton className="h-64 w-full" />;
  if (runs.isError) return <PanelError label="Could not load runs" />;
  if (!effectiveRunId) {
    return (
      <div className="rounded-xl border border-dashed border-sand bg-warmwhite p-10 text-center text-sm text-bark">
        No verification has been run yet. Upload a quote and press Verify.
      </div>
    );
  }
  if (report.isLoading) return <Skeleton className="h-64 w-full" />;
  if (report.isError || !report.data) return <PanelError label="Could not load the report" />;

  const { run, quoteFile, orders } = report.data;
  const shown = filter ? orders.filter((o) => o.outcome === filter) : orders;

  return (
    <div className="space-y-5">
      {/* run picker */}
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="run-picker" className="text-xs text-bark">
          Run
        </Label>
        <select
          id="run-picker"
          value={effectiveRunId}
          onChange={(e) => onPickRun(e.target.value)}
          className="h-9 rounded-md border border-sand bg-warmwhite px-2 text-sm text-soil"
        >
          {runs.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.started_at).toLocaleString("en-AU")} — {r.orders_total} orders
            </option>
          ))}
        </select>

        <div className="ml-auto">
          <Button variant="outline" size="sm" asChild>
            <a href={`${BASE}/runs/${effectiveRunId}/export`}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download CSV
            </a>
          </Button>
        </div>
      </div>

      {quoteFile && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-bark">
          <RetailerBadge retailer={quoteFile.retailer} />
          <span className="text-soil">{quoteFile.file_name}</span>
          <span className="text-clay">·</span>
          <span>
            {quoteFile.period_start} → {quoteFile.period_end}
          </span>
        </div>
      )}

      {run.status === "failed" && (
        <PanelError label={`This run failed: ${run.error ?? "unknown error"}`} />
      )}

      {run.coverage?.warning && (
        <div className="flex items-start gap-2 rounded-lg border border-harvest/30 bg-harvest/5 p-3 text-xs text-bark">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-harvest" />
          <span>{run.coverage.warning}</span>
        </div>
      )}

      {/* totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Orders" value={run.orders_total} onClick={() => setFilter(null)} active={filter === null} />
        <StatTile label="Verified" value={run.orders_verified} tone="canopy" onClick={() => setFilter("verified")} active={filter === "verified"} />
        <StatTile label="Mismatch" value={run.orders_mismatched} tone="blaze" onClick={() => setFilter("mismatch")} active={filter === "mismatch"} />
        <StatTile label="Partly checked" value={run.orders_partial} tone="harvest" onClick={() => setFilter("partial")} active={filter === "partial"} />
        <StatTile label="No quote" value={run.orders_no_quote} onClick={() => setFilter("no_quote")} active={filter === "no_quote"} />
        <StatTile label="Skipped" value={run.orders_skipped + run.orders_unmapped} onClick={() => setFilter("skipped")} active={filter === "skipped"} />
      </div>

      <div className="text-xs text-stone">
        {run.lines_total} line(s) checked — {run.lines_matched} matched,{" "}
        {run.lines_mismatched} mismatched, {run.lines_no_quote} not checkable.
        {run.orders_duplicate > 0 && ` ${run.orders_duplicate} order(s) flagged as duplicates.`}
        {run.orders_unmapped > 0 && ` ${run.orders_unmapped} order(s) on an unmapped DC.`}
      </div>

      {/* orders */}
      <div className="rounded-xl border border-sand bg-warmwhite">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Consignee</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="text-right">Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-clay">
                  No orders in this category.
                </TableCell>
              </TableRow>
            )}
            {shown.map((o) => {
              const isOpen = expanded === o.id;
              const lines = linesByOrder.get(o.id) ?? [];
              return (
                <Fragment key={o.id}>
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : o.id)}
                  >
                    <TableCell className="text-sm font-medium text-soil">
                      {o.order_no ?? "—"}
                      {o.is_duplicate && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          duplicate
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-bark">{shortDate(o.delivery_date)}</TableCell>
                    <TableCell className="text-sm text-bark">
                      {o.consignee_name ?? o.consignee_code ?? "—"}
                      {o.dc_code && <span className="ml-1 text-xs text-clay">({o.dc_code})</span>}
                    </TableCell>
                    <TableCell className="text-xs text-stone">{o.order_state ?? "—"}</TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={o.outcome} />
                      {o.reason && <div className="mt-0.5 text-xs text-stone">{o.reason}</div>}
                    </TableCell>
                    <TableCell className="text-right text-sm text-bark">
                      {o.lines_matched}/{o.lines_total}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow key={`${o.id}-lines`}>
                      <TableCell colSpan={6} className="bg-cream/60 p-0">
                        {detail.isLoading && lines.length === 0 ? (
                          <div className="p-4">
                            <Skeleton className="h-16 w-full" />
                          </div>
                        ) : lines.length === 0 ? (
                          <div className="p-4 text-xs text-stone">
                            {o.reason ?? "This order has no line detail."}
                          </div>
                        ) : (
                          <LineTable lines={lines} />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LineTable({ lines }: { lines: LineRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Line</TableHead>
          <TableHead className="text-xs">Item</TableHead>
          <TableHead className="text-xs">Description</TableHead>
          <TableHead className="text-right text-xs">Order</TableHead>
          <TableHead className="text-right text-xs">Quote</TableHead>
          <TableHead className="text-right text-xs">Variance</TableHead>
          <TableHead className="text-xs">Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="text-xs text-stone">{l.line_no ?? "—"}</TableCell>
            <TableCell className="text-xs font-mono text-soil">{l.item_no ?? "—"}</TableCell>
            <TableCell className="text-xs text-bark">{l.description ?? "—"}</TableCell>
            <TableCell className="text-right text-xs text-bark">{money(l.order_price)}</TableCell>
            <TableCell className="text-right text-xs text-bark">{money(l.quote_price)}</TableCell>
            <TableCell
              className={`text-right text-xs ${
                l.outcome === "mismatch" ? "font-semibold text-blaze" : "text-stone"
              }`}
            >
              {l.variance === null || l.variance === undefined ? "—" : money(l.variance)}
            </TableCell>
            <TableCell>
              <OutcomeBadge outcome={l.outcome} />
              {l.detail && <div className="mt-0.5 text-[11px] text-stone">{l.detail}</div>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatTile({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number;
  tone?: "canopy" | "blaze" | "harvest";
  onClick: () => void;
  active: boolean;
}) {
  const toneClass =
    tone === "canopy"
      ? "text-canopy"
      : tone === "blaze"
        ? "text-blaze"
        : tone === "harvest"
          ? "text-harvest"
          : "text-soil";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition ${
        active ? "border-forest/40 bg-cream" : "border-sand bg-warmwhite hover:border-forest/30"
      }`}
    >
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs text-bark">{label}</div>
    </button>
  );
}

// ====================================================== tab 3 — settings

function SettingsTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery<Settings>({
    queryKey: ["pv-settings"],
    queryFn: () => safeFetch(`${BASE}/settings`),
  });
  const dcMap = useQuery<DcMapResponse>({
    queryKey: ["pv-dc-map"],
    queryFn: () => safeFetch(`${BASE}/dc-map`),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => postJson(`${BASE}/settings`, patch, "PATCH"),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["pv-settings"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveMapping = useMutation({
    mutationFn: (body: { retailer: string; dcCode: string; entityCode: string | null }) =>
      postJson(`${BASE}/dc-map`, body, "PATCH"),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["pv-dc-map"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (settings.isLoading || dcMap.isLoading) return <Skeleton className="h-64 w-full" />;
  if (settings.isError || !settings.data) return <PanelError label="Could not load settings" />;

  const s = settings.data;

  return (
    <div className="space-y-5">
      {error && <PanelError label={error} />}

      {!isHubAdmin && (
        <div className="rounded-lg border border-sand bg-parchment p-3 text-xs text-bark">
          These settings are read-only for you. A hub admin can change them.
        </div>
      )}

      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h3 className="text-sm font-semibold text-soil">Matching rules</h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tolerance" className="text-xs text-bark">
              Price tolerance (AUD)
            </Label>
            <Input
              id="tolerance"
              type="number"
              step="0.01"
              min="0"
              defaultValue={s.tolerance}
              disabled={!isHubAdmin}
              className="mt-1"
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== s.tolerance) save.mutate({ tolerance: v });
              }}
            />
            <p className="mt-1 text-xs text-stone">
              0 means the order price must equal the quote exactly.
            </p>
          </div>

          <div>
            <Label htmlFor="unapproved" className="text-xs text-bark">
              Quote rows that are not approved
            </Label>
            <select
              id="unapproved"
              defaultValue={s.unapprovedQuotes}
              disabled={!isHubAdmin}
              className="mt-1 h-9 w-full rounded-md border border-sand bg-warmwhite px-2 text-sm text-soil disabled:opacity-60"
              onChange={(e) =>
                save.mutate({ unapprovedQuotes: e.target.value as "use" | "skip" })
              }
            >
              <option value="use">Compare against them anyway</option>
              <option value="skip">Treat as no usable quote</option>
            </select>
            <p className="mt-1 text-xs text-stone">
              Coles marks many priced rows &quot;Unchecked&quot;. Comparing against
              them is what reproduces the manually-verified baseline.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <StateListEditor
            label="Order states that get verified"
            states={s.verifiableStates}
            disabled={!isHubAdmin}
            onChange={(verifiableStates) => save.mutate({ verifiableStates })}
          />
          <StateListEditor
            label="Order states skipped outright"
            states={s.skipStates}
            disabled={!isHubAdmin}
            onChange={(skipStates) => save.mutate({ skipStates })}
          />
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs text-stone">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Any state in neither list is reported as skipped with its state named —
          &quot;WWG- Load Moved&quot; is the live example.
        </p>
      </div>

      {/* DC mapping */}
      <div className="rounded-xl border border-sand bg-warmwhite">
        <div className="border-b border-sand p-5">
          <h3 className="text-sm font-semibold text-soil">
            Distribution centre mapping
          </h3>
          <p className="mt-1 text-xs text-bark">
            Which FreshTrack consignee each retailer DC code corresponds to. An
            unmapped DC is reported, never silently dropped.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Retailer</TableHead>
              <TableHead>DC code</TableHead>
              <TableHead>DC name</TableHead>
              <TableHead>FreshTrack consignee</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dcMap.data?.mappings.map((m) => (
              <TableRow key={`${m.retailer}-${m.dcCode}`}>
                <TableCell>
                  <RetailerBadge retailer={m.retailer} />
                </TableCell>
                <TableCell className="font-mono text-xs text-soil">{m.dcCode}</TableCell>
                <TableCell className="text-sm text-bark">{m.dcLabel ?? "—"}</TableCell>
                <TableCell>
                  <select
                    value={m.entityCode ?? ""}
                    disabled={!isHubAdmin}
                    className={`h-8 w-full rounded-md border px-2 text-xs disabled:opacity-60 ${
                      m.entityCode
                        ? "border-sand bg-warmwhite text-soil"
                        : "border-harvest/40 bg-harvest/5 text-bark"
                    }`}
                    onChange={(e) =>
                      saveMapping.mutate({
                        retailer: m.retailer,
                        dcCode: m.dcCode,
                        entityCode: e.target.value || null,
                      })
                    }
                  >
                    <option value="">— not mapped —</option>
                    {dcMap.data?.entities.map((ent) => (
                      <option key={ent.code} value={ent.code}>
                        {ent.code} — {ent.name}
                      </option>
                    ))}
                  </select>
                  {m.altEntityCodes.length > 0 && (
                    <div className="mt-1 text-[11px] text-stone">
                      also accepts {m.altEntityCodes.join(", ")}
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-xs text-[11px] text-stone">
                  {m.notes ?? ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border border-sand bg-parchment p-4 text-xs text-bark">
        <strong className="text-soil">Writing back to FreshTrack is not enabled.</strong>{" "}
        Marking a verified order with a &quot;Price Verified&quot; state needs
        that state to exist in FreshTrack first, and a decision about which
        transitions are legal. Until then this tool only reports.
      </div>
    </div>
  );
}

function StateListEditor({
  label,
  states,
  disabled,
  onChange,
}: {
  label: string;
  states: string[];
  disabled: boolean;
  onChange: (states: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <Label className="text-xs text-bark">{label}</Label>
      <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-sand bg-warmwhite p-2">
        {states.map((state) => (
          <span
            key={state}
            className="inline-flex items-center gap-1 rounded bg-parchment px-2 py-0.5 text-xs text-soil"
          >
            {state}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${state}`}
                onClick={() => onChange(states.filter((s) => s !== state))}
                className="text-stone hover:text-blaze"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {states.length === 0 && <span className="text-xs text-clay">none</span>}
      </div>
      {!disabled && (
        <div className="mt-1.5 flex gap-2">
          <Input
            value={draft}
            placeholder="Add a state name"
            className="h-8 text-xs"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                if (!states.includes(draft.trim())) onChange([...states, draft.trim()]);
                setDraft("");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ======================================================== tab 4 — access

function AccessTab() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const access = useQuery<{ users: AccessUser[] }>({
    queryKey: ["pv-access"],
    queryFn: () => safeFetch(`${BASE}/access`),
  });

  const toggle = useMutation({
    mutationFn: (vars: { userId: string; grant: boolean }) =>
      postJson<{ users: AccessUser[] }>(`${BASE}/access`, vars),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(["pv-access"], data);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (access.isLoading) return <Skeleton className="h-56 w-full" />;
  if (access.isError) return <PanelError label="Could not load tool access" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
          <div>
            <h3 className="text-sm font-semibold text-soil">Who can use this tool</h3>
            <p className="mt-1 text-xs text-bark">
              Retailer quote pricing is commercially sensitive, so this tool is
              off by default and granted person by person. Only Mackays internal
              accounts can be given access — grower-side accounts never reach the
              Tools section at all.
            </p>
          </div>
        </div>
      </div>

      {error && <PanelError label={error} />}

      <div className="rounded-xl border border-sand bg-warmwhite">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Access</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {access.data?.users.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-clay">
                  <Users className="mx-auto mb-2 h-6 w-6" />
                  No internal users found.
                </TableCell>
              </TableRow>
            )}
            {access.data?.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="text-sm text-soil">{u.name || "—"}</TableCell>
                <TableCell className="text-sm text-bark">{u.email}</TableCell>
                <TableCell className="text-xs text-stone">
                  {u.hubRole === "hub_admin" ? "Hub admin" : (u.moduleRole ?? "—")}
                </TableCell>
                <TableCell className="text-right">
                  {u.alwaysAllowed ? (
                    <span className="inline-flex items-center gap-1 text-xs text-canopy">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Always (hub admin)
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={u.hasAccess ? "outline" : "default"}
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ userId: u.id, grant: !u.hasAccess })}
                    >
                      {u.hasAccess ? "Revoke" : "Grant access"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
