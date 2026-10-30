"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RotateCcw,
  Mail,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PanelError } from "@/components/panel-error";
import { safeFetch } from "@/lib/portal-constants";
import { validateRecipients } from "@/lib/processes/runReport/recipients";
import { DECISION_REASON_LABELS } from "@/lib/processes/consignorAssign/decisionReasons";
import {
  parseSchedule,
  describeSchedule,
  MAX_INTERVAL_MINUTES,
} from "@/lib/processes/schedule";
import {
  scheduleToOption,
  optionToSchedule,
  selectedMinutes,
  FREQUENCY_OPTIONS,
  INTERVAL_CHOICES,
  CUSTOM_MINUTES,
  UNEDITABLE,
  type StoredSchedule,
} from "@/lib/processes/scheduleOptions";

const BASE = "/api/tools/consignor-auto-assign";
const RUN_URL = "/api/processes/consignor_auto_assign/run";
const REPORT_BASE = `${BASE}/report-settings`;
const REPORT_RUN_URL = "/api/processes/consignor_auto_assign_report/run";
const MARKETER_BASE = `${BASE}/marketer`;
const MARKETER_RUN_URL = "/api/processes/marketer_auto_fill/run";

/** Like safeFetch, but keeps the API's own error message for the page. */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --------------------------------------------------------------- shared types

interface RunRow {
  id: string;
  trigger: "cron" | "manual";
  mode: "dry_run" | "apply";
  status: string;
  started_at: string;
  completed_at: string | null;
  candidates_seen: number;
  actions_proposed: number;
  actions_applied: number;
  actions_skipped: number;
  actions_failed: number;
  error: string | null;
}

interface InvalidRule {
  rule: {
    consignee_entity_code: string | null;
    consignor_entity_code: string | null;
    product_code?: string | null;
    crop_name?: string | null;
  };
  reason: string;
}

interface DecisionItem {
  id: string;
  target_ref: string | null;
  consignee_name: string | null;
  skip_reason: string;
  created_at: string;
}

interface OverviewResponse {
  process: { key: string; name: string; enabled: boolean; mode: string } | null;
  latestRun: RunRow | null;
  ruleHealth: { validCount: number; invalidRules: InvalidRule[]; error: string | null };
  needsDecision: DecisionItem[];
}

interface RuleRow {
  id: string;
  consignee_entity_code: string | null; // null = any customer (global rule)
  consignee_freshtrack_id: string | null;
  crop_id: string | null;
  crop_name: string | null;
  // Migration 00024: a rule may target one product, and may leave it blank.
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  action: "assign" | "leave_blank";
  consignor_entity_code: string | null; // null only for leave_blank
  consignor_freshtrack_id: string | null;
  enabled: boolean;
  notes: string | null;
}

interface PickerProduct {
  id: string;
  code: string;
  name: string;
  cropId: string | null;
  cropName: string | null;
  isActive: boolean;
  isSellable: boolean;
}

interface ActivityRow {
  id: string;
  target_ref: string | null;
  consignee_name: string | null;
  action: string;
  status: "proposed" | "applied" | "skipped" | "failed";
  skip_reason: string | null;
  after: { code?: string } | null;
  error: string | null;
  applied_at: string | null;
  created_at: string;
}

interface SettingsResponse {
  key: string;
  name: string;
  enabled: boolean;
  mode: "dry_run" | "apply";
  config: {
    schedule?: StoredSchedule;
    assignable_state_codes?: string[];
    discovery_lookback_days?: number;
    discovery_horizon_days?: number;
  };
}

interface OrderStateOption {
  code: string;
  name: string;
  sequence: number;
}

interface ReportSettingsResponse {
  process: {
    key: string;
    name: string;
    enabled: boolean;
    config: {
      recipient_email?: string;
      schedule?: SettingsResponse["config"]["schedule"];
      alert_on_conflicts?: boolean;
    };
    updated_at: string;
  } | null;
  latestRun: {
    id: string;
    trigger: "cron" | "manual";
    status: string;
    started_at: string;
    completed_at: string | null;
    error: string | null;
    payload: Record<string, unknown> | null;
  } | null;
}

const SKIP_REASON_LABEL: Record<string, string> = {
  ambiguous_multi_crop: "Mixed crops — no single correct consignor",
  left_blank_by_rule: "Left blank by rule (e.g. green fruit)",
  // Marketer fill
  out_of_scope_customer: "Customer isn't in the marketer fill's groups",
  marketer_already_set: "Marketer already set",
  no_rule_matched: "No mapping rule for this customer/crop",
  archived: "Order is archived",
  state_not_assignable: "Order state isn't assignable (e.g. cancelled)",
  anomaly_progressed_without_consignor: "Order moved without ever having a consignor",
  already_assigned_by_other: "Assigned by someone else during this run",
  no_consignee: "Order has no consignee on record",
  crop_resolution_budget_exceeded: "Deferred — crop lookup budget hit this run",
};

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  return SKIP_REASON_LABEL[reason] ?? DECISION_REASON_LABELS[reason] ?? reason;
}

// ------------------------------------------------------------------- page

export function ConsignorAutoAssignClient({ isHubAdmin }: { isHubAdmin: boolean }) {
  return (
    <div className="space-y-6">
      <TopBar title="Auto FT Consignor Update" />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rules">Mapping rules</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          <TabsTrigger value="schedule">Schedule &amp; run</TabsTrigger>
          <TabsTrigger value="reports">Email reports</TabsTrigger>
          <TabsTrigger value="marketer">Marketer fill</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab isHubAdmin={isHubAdmin} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesTab isHubAdmin={isHubAdmin} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab isHubAdmin={isHubAdmin} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleTab isHubAdmin={isHubAdmin} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab isHubAdmin={isHubAdmin} />
        </TabsContent>
        <TabsContent value="marketer">
          <MarketerTab isHubAdmin={isHubAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --------------------------------------------------------------- Overview

function OverviewTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<OverviewResponse>({
    queryKey: ["tools-consignor-overview"],
    queryFn: () => safeFetch<OverviewResponse>(`${BASE}/overview`),
    refetchInterval: 30000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(RUN_URL, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Run failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-overview"] });
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-activity"] });
    },
  });

  if (isLoading) return <Skeleton className="mt-4 h-[320px] rounded-xl" />;
  if (error) return <PanelError className="mt-4" label="Failed to load overview — try refreshing" />;

  const run = data?.latestRun;
  const health = data?.ruleHealth;
  const enabled = data?.process?.enabled ?? false;
  const mode = data?.process?.mode ?? "dry_run";

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-soil">Status</span>
            <Badge variant={mode === "apply" ? "default" : "secondary"} className={mode === "apply" ? "bg-canopy" : "bg-harvest/20 text-harvest"}>
              {mode === "apply" ? "Live" : "Dry run"}
            </Badge>
            {!enabled && (
              <Badge variant="outline" className="border-stone text-stone">
                Paused
              </Badge>
            )}
          </div>
          {isHubAdmin && (
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={runMutation.isPending || !enabled}
              onClick={() => runMutation.mutate()}
              title={!enabled ? "Enable the process under Schedule & run first" : undefined}
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Run now
            </Button>
          )}
        </div>

        {runMutation.isError && (
          <p className="mb-3 text-xs text-blaze">{runMutation.error?.message}</p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Unassigned found" value={run?.candidates_seen ?? 0} />
          <StatCard
            label={mode === "apply" ? "Auto-assigned" : "Would assign"}
            value={mode === "apply" ? run?.actions_applied ?? 0 : run?.actions_proposed ?? 0}
            tone="success"
          />
          <StatCard
            label="Needs a decision"
            value={data?.needsDecision.length ?? 0}
            tone={data && data.needsDecision.length > 0 ? "warning" : undefined}
          />
          <StatCard label="Failed" value={run?.actions_failed ?? 0} tone={run && run.actions_failed > 0 ? "danger" : undefined} />
        </div>

        <div className="mt-4 space-y-1.5 border-t border-sand pt-3 text-xs text-bark">
          {run ? (
            <p>
              Last run {new Date(run.started_at).toLocaleString("en-AU")} ({run.trigger}, {run.status})
            </p>
          ) : (
            <p>No runs yet.</p>
          )}
          {run?.error && <p className="text-blaze">{run.error}</p>}
        </div>
      </div>

      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h3 className="mb-3 text-sm font-semibold text-soil">Rule health</h3>
        {health?.error ? (
          <p className="flex items-center gap-2 text-xs text-blaze">
            <XCircle className="h-3.5 w-3.5" />
            Couldn&apos;t validate rules against FreshTrack: {health.error}
          </p>
        ) : health && health.invalidRules.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-canopy">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All {health.validCount} rules check out against FreshTrack
          </p>
        ) : (
          <div className="space-y-1.5">
            {health?.invalidRules.map((r, i) => (
              <p key={i} className="flex items-center gap-2 text-xs text-blaze">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {r.rule.consignee_entity_code ?? "Any customer"}
                {r.rule.product_code ? ` + ${r.rule.product_code}` : r.rule.crop_name ? ` + ${r.rule.crop_name}` : ""} →{" "}
                {r.rule.consignor_entity_code ?? "leave blank"}: {r.reason}
              </p>
            ))}
          </div>
        )}
      </div>

      {data && data.needsDecision.length > 0 && (
        <div className="rounded-xl border border-harvest/30 bg-harvest/5 p-5">
          <h3 className="mb-3 text-sm font-semibold text-soil">Needs a decision</h3>
          <div className="space-y-2">
            {data.needsDecision.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-xs">
                <span className="text-bark">
                  Order {item.target_ref ?? "—"} · {item.consignee_name ?? "Unknown customer"}
                </span>
                <span className="text-harvest">{reasonLabel(item.skip_reason)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-canopy"
      : tone === "warning"
        ? "text-harvest"
        : tone === "danger"
          ? "text-blaze"
          : "text-soil";
  return (
    <div className="rounded-lg bg-cream px-3 py-2.5">
      <div className="text-[11px] text-stone">{label}</div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------- Rules

const EMPTY_RULE_FORM: RuleForm = {
  consignee_entity_code: "",
  consignee_freshtrack_id: "",
  crop_id: "",
  crop_name: "",
  product_codes: [],
  action: "assign",
  consignor_entity_code: "",
  consignor_freshtrack_id: "",
  notes: "",
};

/** What a rule applies to, in one short phrase for the table and dialogs. */
function ruleTarget(rule: Pick<RuleRow, "product_code" | "product_name" | "crop_name">): string {
  if (rule.product_code) return `${rule.product_code} · ${rule.product_name ?? ""}`.trim();
  return rule.crop_name ?? "Any";
}

function RulesTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);

  const { data, isLoading, error } = useQuery<RuleRow[]>({
    queryKey: ["tools-consignor-rules"],
    queryFn: () => safeFetch<RuleRow[]>(`${BASE}/rules`),
  });

  function resetForm() {
    setForm(EMPTY_RULE_FORM);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          crop_id: form.crop_id || null,
          crop_name: form.crop_name || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create rule");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-rules"] });
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-overview"] });
      setAddOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      // An edit is one rule, so it sends one product (or none).
      const { product_codes, ...rest } = form;
      const res = await fetch(`${BASE}/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rest, product_code: product_codes[0] ?? "" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update rule");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-rules"] });
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-overview"] });
      setEditing(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/rules/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete rule");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tools-consignor-rules"] }),
  });

  const rules = data ?? [];

  return (
    <div className="mt-4 space-y-4">
      {isHubAdmin && (
        <div className="flex justify-end">
          <Button size="sm" className="bg-canopy text-white hover:bg-canopy/90" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add rule
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-[240px] rounded-xl" />
      ) : error ? (
        <PanelError label="Failed to load rules — try refreshing" />
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Customer</TableHead>
                <TableHead className="text-xs text-stone">Crop or product</TableHead>
                <TableHead className="text-xs text-stone">Consignor</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                {isHubAdmin && <TableHead className="w-[80px] text-xs text-stone"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-stone">
                    No mapping rules yet
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={`border-sand/50 ${rule.consignee_entity_code === null ? "bg-harvest/5" : ""}`}
                  >
                    <TableCell className="font-medium text-soil">
                      {rule.consignee_entity_code ?? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant="outline" className="border-harvest/40 text-harvest">
                            Global
                          </Badge>
                          Any customer
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[320px] text-bark">
                      {rule.product_code ? (
                        <span className="flex items-center gap-1.5">
                          <Badge variant="outline" className="shrink-0 border-sand text-stone">
                            Product
                          </Badge>
                          <span className="truncate" title={ruleTarget(rule)}>
                            {ruleTarget(rule)}
                          </span>
                        </span>
                      ) : (
                        ruleTarget(rule)
                      )}
                    </TableCell>
                    <TableCell className="text-bark">
                      {rule.action === "leave_blank" ? (
                        <Badge variant="outline" className="border-stone/40 text-stone">
                          Leave blank
                        </Badge>
                      ) : (
                        rule.consignor_entity_code
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          rule.enabled ? "bg-canopy/10 text-canopy" : "bg-stone/10 text-stone"
                        }`}
                      >
                        {rule.enabled ? "Active" : "Disabled"}
                      </span>
                    </TableCell>
                    {isHubAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Edit rule"
                            onClick={() => {
                              setForm({
                                consignee_entity_code: rule.consignee_entity_code ?? "",
                                consignee_freshtrack_id: rule.consignee_freshtrack_id ?? "",
                                crop_id: rule.crop_id ?? "",
                                crop_name: rule.crop_name ?? "",
                                product_codes: rule.product_code ? [rule.product_code] : [],
                                action: rule.action,
                                consignor_entity_code: rule.consignor_entity_code ?? "",
                                consignor_freshtrack_id: rule.consignor_freshtrack_id ?? "",
                                notes: rule.notes ?? "",
                              });
                              setEditing(rule);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 text-stone" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Delete rule"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              const who = rule.consignee_entity_code ?? "Any customer";
                              const to = rule.action === "leave_blank" ? "leave blank" : rule.consignor_entity_code;
                              if (confirm(`Delete the ${who} + ${ruleTarget(rule)} → ${to} rule?`)) {
                                deleteMutation.mutate(rule.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-blaze" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-1 text-xs text-stone">
        <p>
          The most specific rule wins: a product rule, then a crop rule, then the customer&apos;s
          &quot;Any&quot; rule. At each level the customer&apos;s own rule beats an any-customer rule.
        </p>
        <p>
          &quot;Leave blank&quot; rules never set a consignor — use them for green fruit, whose
          consignor is set when the farm load is linked. An order that mixes a leave-blank product
          with an assigned one, or has a product no rule covers, is left for a person under
          &quot;Needs a decision&quot; — never guessed.
        </p>
      </div>

      <RuleFormDialog
        open={addOpen || editing !== null}
        title={editing ? "Edit rule" : "Add rule"}
        editing={editing !== null}
        form={form}
        setForm={setForm}
        onCancel={() => {
          setAddOpen(false);
          setEditing(null);
          resetForm();
        }}
        onSubmit={() => (editing ? updateMutation.mutate(editing.id) : createMutation.mutate())}
        pending={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message}
      />
    </div>
  );
}

interface RuleForm {
  consignee_entity_code: string;
  consignee_freshtrack_id: string;
  crop_id: string;
  crop_name: string;
  /** FreshTrack product codes. Adding: one rule per code. Editing: at most one. */
  product_codes: string[];
  action: "assign" | "leave_blank";
  consignor_entity_code: string;
  consignor_freshtrack_id: string;
  notes: string;
}

function RuleFormDialog({
  open,
  title,
  editing,
  form,
  setForm,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  editing: boolean;
  form: RuleForm;
  setForm: (f: RuleForm) => void;
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  const { data: products, isLoading: productsLoading, error: productsError } = useQuery<PickerProduct[]>({
    queryKey: ["tools-consignor-products"],
    queryFn: () => fetchJson<PickerProduct[]>(`${BASE}/products`),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const hasConsigneeCode = form.consignee_entity_code.trim().length > 0;
  const hasConsigneeId = form.consignee_freshtrack_id.trim().length > 0;
  const consigneeConsistent = hasConsigneeCode === hasConsigneeId;
  const hasCrop = form.crop_id.trim().length > 0;
  const hasProducts = form.product_codes.length > 0;
  const leaveBlank = form.action === "leave_blank";
  const valid =
    consigneeConsistent &&
    (hasConsigneeCode || hasCrop || hasProducts) &&
    !(hasCrop && hasProducts) &&
    (leaveBlank ||
      (Boolean(form.consignor_entity_code.trim()) && Boolean(form.consignor_freshtrack_id.trim())));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-warmwhite sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-soil">{title}</DialogTitle>
          <DialogDescription className="text-stone">
            Customer + an optional crop or products → the consignor to set when an order&apos;s
            consignor is blank, or &quot;leave blank&quot;. Leave the customer blank for a rule
            that applies to ANY customer — e.g. all Passionfruit via SQBR.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer code">
              <Input
                value={form.consignee_entity_code}
                onChange={(e) => setForm({ ...form, consignee_entity_code: e.target.value })}
                placeholder="e.g. WOWTO — blank = Any customer"
                className="border-sand bg-white"
              />
            </Field>
            <Field label="Consignee FreshTrack role id">
              <Input
                value={form.consignee_freshtrack_id}
                onChange={(e) => setForm({ ...form, consignee_freshtrack_id: e.target.value })}
                placeholder="UUID — blank = Any customer"
                className="border-sand bg-white font-mono text-xs"
              />
            </Field>
          </div>
          {!consigneeConsistent && (
            <p className="text-xs text-blaze">
              Customer code and role id must be given together, or both left blank.
            </p>
          )}

          <Field label={editing ? "Product (optional — one per rule when editing)" : "Products (optional — one rule is made for each)"}>
            {productsLoading ? (
              <Skeleton className="h-32 rounded-lg" />
            ) : productsError ? (
              <p className="text-xs text-blaze">Couldn&apos;t load products from FreshTrack: {productsError.message}</p>
            ) : (
              <ProductPicker
                products={products ?? []}
                selected={form.product_codes}
                single={editing}
                disabled={hasCrop}
                onChange={(product_codes) => setForm({ ...form, product_codes })}
              />
            )}
            {hasCrop && (
              <p className="mt-1 text-xs text-stone">Clear the crop to pick products — a rule is for a crop or products, not both.</p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Crop (optional)">
              <Input
                value={form.crop_name}
                disabled={hasProducts}
                onChange={(e) => setForm({ ...form, crop_name: e.target.value })}
                placeholder={hasProducts ? "Not used with products" : "e.g. Passionfruit — blank = Any"}
                className="border-sand bg-white disabled:opacity-60"
              />
            </Field>
            <Field label="Crop FreshTrack id (if crop set)">
              <Input
                value={form.crop_id}
                disabled={hasProducts}
                onChange={(e) => setForm({ ...form, crop_id: e.target.value })}
                placeholder="UUID"
                className="border-sand bg-white font-mono text-xs disabled:opacity-60"
              />
            </Field>
          </div>
          {!hasConsigneeCode && !hasCrop && !hasProducts && (
            <p className="text-xs text-blaze">
              A rule needs a customer, a crop or a product — leaving all three blank would match
              every order.
            </p>
          )}

          <Field label="When this matches">
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value as RuleForm["action"] })}
              className="h-9 w-full rounded-lg border border-sand bg-white px-2 text-sm"
            >
              <option value="assign">Set this consignor</option>
              <option value="leave_blank">Leave the consignor blank (a person sets it, e.g. green fruit)</option>
            </select>
          </Field>

          {!leaveBlank && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Consignor code *">
                <Input
                  value={form.consignor_entity_code}
                  onChange={(e) => setForm({ ...form, consignor_entity_code: e.target.value })}
                  placeholder="e.g. MMANN"
                  className="border-sand bg-white"
                />
              </Field>
              <Field label="Consignor FreshTrack role id *">
                <Input
                  value={form.consignor_freshtrack_id}
                  onChange={(e) => setForm({ ...form, consignor_freshtrack_id: e.target.value })}
                  placeholder="UUID"
                  className="border-sand bg-white font-mono text-xs"
                />
              </Field>
            </div>
          )}

          <Field label="Notes">
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional context"
              className="border-sand bg-white"
            />
          </Field>
        </div>
        {error && <p className="text-xs text-blaze">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-canopy text-white hover:bg-canopy/90"
            disabled={!valid || pending}
            onClick={onSubmit}
          >
            {pending
              ? "Saving..."
              : !editing && form.product_codes.length > 1
                ? `Save ${form.product_codes.length} rules`
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Searchable product list, grouped by crop. Retired products are hidden
 * unless already chosen. `single` (editing) keeps at most one ticked.
 */
function ProductPicker({
  products,
  selected,
  single,
  disabled,
  onChange,
}: {
  products: PickerProduct[];
  selected: string[];
  single: boolean;
  disabled: boolean;
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      (p.isActive || selected.includes(p.code)) &&
      (!q || `${p.code} ${p.name} ${p.cropName ?? ""}`.toLowerCase().includes(q))
  );
  const groups = new Map<string, PickerProduct[]>();
  for (const p of visible) {
    const key = p.cropName ?? "No crop";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  function toggle(code: string) {
    if (selected.includes(code)) onChange(selected.filter((c) => c !== code));
    else onChange(single ? [code] : [...selected, code]);
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by code or name, e.g. 910111 or ripe"
        className="border-sand bg-white"
        disabled={disabled}
      />
      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-sand bg-white p-2">
        {visible.length === 0 ? (
          <p className="px-1 py-2 text-xs text-stone">No products match.</p>
        ) : (
          Array.from(groups.entries()).map(([crop, items]) => (
            <div key={crop} className="mb-1.5 last:mb-0">
              <p className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-stone">{crop}</p>
              {items.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-bark hover:bg-cream"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(p.code)}
                    onChange={() => toggle(p.code)}
                    disabled={disabled}
                    className="h-3.5 w-3.5 shrink-0 rounded border-sand accent-canopy"
                  />
                  <span className="w-14 shrink-0 font-mono text-[11px] text-stone">{p.code}</span>
                  <span className="truncate" title={p.name}>
                    {p.name}
                  </span>
                  {!p.isActive && <span className="shrink-0 text-[10px] text-stone">(inactive)</span>}
                </label>
              ))}
            </div>
          ))
        )}
      </div>
      <p className="mt-1 text-xs text-stone">
        {selected.length === 0 ? "None chosen — the rule is for a crop or any product." : `Chosen: ${selected.join(", ")}`}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-bark">{label}</Label>
      {children}
    </div>
  );
}

// --------------------------------------------------------------- Activity

function ActivityTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery<ActivityRow[]>({
    queryKey: ["tools-consignor-activity", statusFilter],
    queryFn: () =>
      safeFetch<ActivityRow[]>(
        `${BASE}/activity${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
      ),
  });

  const unassignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/activity/${id}/unassign`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to unassign");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tools-consignor-activity"] }),
  });

  const rows = data ?? [];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-1.5">
        {(["all", "applied", "proposed", "skipped", "failed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s ? "bg-forest text-white" : "bg-sand/60 text-bark hover:bg-sand"
            }`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-[300px] rounded-xl" />
      ) : error ? (
        <PanelError label="Failed to load activity — try refreshing" />
      ) : (
        <div className="rounded-xl border border-sand bg-warmwhite">
          <Table>
            <TableHeader>
              <TableRow className="border-sand hover:bg-transparent">
                <TableHead className="text-xs text-stone">Order</TableHead>
                <TableHead className="text-xs text-stone">Customer</TableHead>
                <TableHead className="text-xs text-stone">Status</TableHead>
                <TableHead className="text-xs text-stone">Detail</TableHead>
                <TableHead className="text-xs text-stone">When</TableHead>
                {isHubAdmin && <TableHead className="w-[90px] text-xs text-stone"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-stone">
                    No activity yet
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="border-sand/50">
                    <TableCell className="font-mono text-xs text-soil">{row.target_ref ?? "—"}</TableCell>
                    <TableCell className="text-bark">{row.consignee_name ?? "—"}</TableCell>
                    <TableCell>
                      <ActivityStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-bark">
                      {row.status === "applied" || row.status === "proposed"
                        ? `→ ${row.after?.code ?? "—"}`
                        : row.status === "failed"
                          ? row.error ?? "—"
                          : reasonLabel(row.skip_reason)}
                    </TableCell>
                    <TableCell className="text-xs text-bark">
                      {new Date(row.created_at).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    {isHubAdmin && (
                      <TableCell>
                        {row.status === "applied" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={unassignMutation.isPending}
                            onClick={() => {
                              if (confirm(`Clear the consignor set on order ${row.target_ref}?`)) {
                                unassignMutation.mutate(row.id);
                              }
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Unassign
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ActivityStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    applied: "bg-canopy/10 text-canopy",
    proposed: "bg-harvest/15 text-harvest",
    skipped: "bg-sand/60 text-stone",
    failed: "bg-blaze/10 text-blaze",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

// --------------------------------------------------------------- Schedule

/**
 * The schedule control, shared by "Schedule & run" and "Email reports" so the
 * two can't drift. Markup mirrors <Row> rather than reusing it because the
 * uneven-cadence warning has to sit under the hint, inside the left column.
 */
function ScheduleField({
  label,
  schedule,
  disabled,
  onChange,
}: {
  label: string;
  schedule?: StoredSchedule;
  disabled: boolean;
  onChange: (next: StoredSchedule) => void;
}) {
  const option = scheduleToOption(schedule);
  const parsed = parseSchedule(schedule);
  const minutes = selectedMinutes(schedule);

  return (
    <div className="flex items-center justify-between border-b border-sand py-3.5 last:border-0">
      <div className="pr-4">
        <p className="text-sm text-soil">{label}</p>
        <p className="text-xs text-stone">
          {parsed ? `Runs ${describeSchedule(parsed)}` : "Not set"}
          {/* Minutes past the hour are the same in every timezone — the
              Brisbane note only means anything for an hour-anchored shape. */}
          {option !== CUSTOM_MINUTES && " — Brisbane time (fixed UTC+10, no DST)"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <select
          aria-label={label}
          disabled={disabled}
          value={option}
          onChange={(e) => onChange(optionToSchedule(e.target.value, minutes))}
          className="h-9 w-[200px] rounded-lg border border-sand bg-white px-2 text-sm disabled:opacity-60"
        >
          {option === UNEDITABLE && (
            <option value={UNEDITABLE} disabled>
              {parsed ? describeSchedule(parsed) : "Custom"}
            </option>
          )}
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {option === CUSTOM_MINUTES && (
          <select
            aria-label={`${label} — interval in minutes`}
            disabled={disabled}
            value={minutes}
            onChange={(e) =>
              onChange({ frequency: "every_n_minutes", n: Number(e.target.value) })
            }
            className="h-9 w-[135px] rounded-lg border border-sand bg-white px-2 text-sm disabled:opacity-60"
          >
            {INTERVAL_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === MAX_INTERVAL_MINUTES ? `${n} min (hourly)` : `${n} min`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ScheduleTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<SettingsResponse>({
    queryKey: ["tools-consignor-settings"],
    queryFn: () => safeFetch<SettingsResponse>(`${BASE}/settings`),
  });
  const { data: orderStates } = useQuery<OrderStateOption[]>({
    queryKey: ["tools-consignor-order-states"],
    queryFn: () => safeFetch<OrderStateOption[]>(`${BASE}/order-states`),
    staleTime: 5 * 60 * 1000, // the state catalogue barely ever changes
  });

  const patchMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`${BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-settings"] });
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-overview"] });
    },
  });

  if (isLoading) return <Skeleton className="mt-4 h-[280px] rounded-xl" />;
  if (error || !data) return <PanelError className="mt-4" label="Failed to load settings — try refreshing" />;

  const assignableStates = data.config.assignable_state_codes ?? ["OR", "FORD", "Default"];

  function toggleState(code: string) {
    const next = assignableStates.includes(code)
      ? assignableStates.filter((c) => c !== code)
      : [...assignableStates, code];
    // Non-null: this closure only ever runs from JSX rendered after the
    // `if (error || !data) return` guard above, so data is always defined
    // by the time a checkbox can be clicked — TS just can't see that through
    // a nested function declaration.
    patchMutation.mutate({
      config: { ...data!.config, assignable_state_codes: next },
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-sand bg-warmwhite p-5">
      {!isHubAdmin && (
        <p className="mb-4 rounded-lg bg-cream px-3 py-2 text-xs text-bark">
          Read-only — changing these settings requires Hub Admin.
        </p>
      )}

      <Row
        label="Mode"
        hint={data.mode === "apply" ? "Writes to FreshTrack" : "Proposes only — writes nothing"}
      >
        <select
          disabled={!isHubAdmin}
          value={data.mode}
          onChange={(e) => patchMutation.mutate({ mode: e.target.value })}
          className="h-9 w-[160px] rounded-lg border border-sand bg-white px-2 text-sm disabled:opacity-60"
        >
          <option value="dry_run">Dry run</option>
          <option value="apply">Apply</option>
        </select>
      </Row>

      <ScheduleField
        label="Run at"
        schedule={data.config.schedule}
        disabled={!isHubAdmin}
        onChange={(schedule) =>
          patchMutation.mutate({ config: { ...data.config, schedule } })
        }
      />

      <div className="border-b border-sand py-3.5">
        <p className="text-sm text-soil">Assignable states</p>
        <p className="mb-2.5 text-xs text-stone">
          The tool only acts on orders in a checked state — everything else (including
          Cancelled) is skipped. A newly-added FreshTrack state starts unchecked, so it&apos;s
          never assignable until someone opts it in.
        </p>
        {!orderStates ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {orderStates.map((state) => (
              <label
                key={state.code}
                className={`flex items-center gap-2 text-xs ${isHubAdmin ? "cursor-pointer text-bark" : "text-stone"}`}
              >
                <input
                  type="checkbox"
                  checked={assignableStates.includes(state.code)}
                  disabled={!isHubAdmin || patchMutation.isPending}
                  onChange={() => toggleState(state.code)}
                  className="h-3.5 w-3.5 rounded border-sand accent-canopy disabled:opacity-60"
                />
                <span className="font-mono text-[11px] text-stone">{state.code}</span>
                {state.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4">
        <div>
          <p className="text-sm font-medium text-blaze">
            {data.enabled ? "Pause process" : "Resume process"}
          </p>
          <p className="text-xs text-bark">
            {data.enabled
              ? "Stops all scheduled and on-demand runs immediately."
              : "Currently paused — no runs will happen until resumed."}
          </p>
        </div>
        {isHubAdmin && (
          <Button
            size="sm"
            variant="outline"
            className={data.enabled ? "border-blaze/40 text-blaze" : "border-canopy/40 text-canopy"}
            disabled={patchMutation.isPending}
            onClick={() => patchMutation.mutate({ enabled: !data.enabled })}
          >
            {data.enabled ? "Pause" : "Resume"}
          </Button>
        )}
      </div>

      {patchMutation.isError && (
        <p className="mt-3 text-xs text-blaze">{patchMutation.error?.message}</p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- Reports

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-canopy/10 text-canopy",
    partial: "bg-harvest/15 text-harvest",
    failed: "bg-blaze/10 text-blaze",
    running: "bg-sand/60 text-stone",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-sand/60 text-stone"}`}>
      {status}
    </span>
  );
}

function ReportsTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [recipientDraft, setRecipientDraft] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ReportSettingsResponse>({
    queryKey: ["tools-consignor-report-settings"],
    queryFn: () => safeFetch<ReportSettingsResponse>(REPORT_BASE),
  });

  const patchMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(REPORT_BASE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update report settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-report-settings"] });
      setRecipientDraft(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(REPORT_RUN_URL, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Send failed");
      }
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tools-consignor-report-settings"] }),
  });

  if (isLoading) return <Skeleton className="mt-4 h-[280px] rounded-xl" />;
  if (error || !data?.process) {
    return <PanelError className="mt-4" label="Failed to load report settings — try refreshing" />;
  }

  const { process: def, latestRun } = data;
  const savedRecipient = def.config.recipient_email ?? "";
  const recipient = recipientDraft ?? savedRecipient;
  const recipientCheck = validateRecipients(recipient);
  const recipientDirty = recipientDraft !== null && recipientDraft !== savedRecipient;
  // Absent means on — the alert is a safety net, so it has to be switched off
  // deliberately rather than by omission. Mirrors conflictAlert.ts.
  const alertsOn = def.config.alert_on_conflicts !== false;

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        {!isHubAdmin && (
          <p className="mb-4 rounded-lg bg-cream px-3 py-2 text-xs text-bark">
            Read-only — changing these settings requires Hub Admin.
          </p>
        )}

        <div className="border-b border-sand py-3.5">
          <p className="mb-1.5 text-sm text-soil">Send to</p>
          <div className="flex gap-2">
            <Input
              value={recipient}
              disabled={!isHubAdmin}
              onChange={(e) => setRecipientDraft(e.target.value)}
              placeholder="name@mackaysmarketing.com.au, another@mackaysmarketing.com.au"
              className="max-w-md border-sand bg-white"
            />
            {isHubAdmin && recipientDirty && (
              <Button
                size="sm"
                className="bg-canopy text-white hover:bg-canopy/90"
                disabled={!recipientCheck.valid || patchMutation.isPending}
                onClick={() =>
                  patchMutation.mutate({ config: { ...def.config, recipient_email: recipient } })
                }
              >
                Save
              </Button>
            )}
          </div>
          {recipientDirty && !recipientCheck.valid ? (
            <p className="mt-1.5 text-xs text-blaze">{recipientCheck.error}.</p>
          ) : (
            <p className="mt-1.5 text-xs text-stone">
              Separate multiple addresses with a comma or semicolon.
            </p>
          )}
        </div>

        <ScheduleField
          label="Send"
          schedule={def.config.schedule}
          disabled={!isHubAdmin}
          onChange={(schedule) =>
            patchMutation.mutate({ config: { ...def.config, schedule } })
          }
        />

        <div className="flex items-center justify-between py-3.5">
          <div>
            <p className="text-sm text-soil">{def.enabled ? "Reports are on" : "Reports are off"}</p>
            <p className="text-xs text-stone">
              {def.enabled
                ? "Sends automatically on the schedule above, and can be sent on demand below."
                : 'Turn on to start sending, and to enable "Send test email now".'}
            </p>
          </div>
          {isHubAdmin && (
            <Button
              size="sm"
              variant="outline"
              className={def.enabled ? "border-stone/40 text-stone" : "border-canopy/40 text-canopy"}
              disabled={patchMutation.isPending}
              onClick={() => patchMutation.mutate({ enabled: !def.enabled })}
            >
              {def.enabled ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-sand py-3.5">
          <div className="pr-4">
            <p className="text-sm text-soil">
              {alertsOn ? "Conflict alerts are on" : "Conflict alerts are off"}
            </p>
            <p className="text-xs text-stone">
              {alertsOn
                ? "Emails the same recipients as soon as a run finds an order the rules can't resolve. Only new orders — a conflict already reported isn't sent again."
                : "Conflicted orders will only appear in the scheduled summary above."}{" "}
              Independent of the summary schedule and of whether reports are on.
            </p>
          </div>
          {isHubAdmin && (
            <Button
              size="sm"
              variant="outline"
              className={alertsOn ? "border-stone/40 text-stone" : "border-canopy/40 text-canopy"}
              disabled={patchMutation.isPending}
              onClick={() =>
                patchMutation.mutate({
                  config: { ...def.config, alert_on_conflicts: !alertsOn },
                })
              }
            >
              {alertsOn ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>

        {isHubAdmin && (
          <div className="flex items-center justify-between border-t border-sand pt-3.5">
            <p className="text-xs text-bark">
              {!def.enabled
                ? "Enable reports above to send a test email."
                : "Sends immediately with the latest data — separate from the schedule."}
            </p>
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={testMutation.isPending || !def.enabled}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Send test email now
            </Button>
          </div>
        )}

        {(patchMutation.isError || testMutation.isError) && (
          <p className="mt-3 text-xs text-blaze">
            {patchMutation.error?.message ?? testMutation.error?.message}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h3 className="mb-3 text-sm font-semibold text-soil">Last send</h3>
        {!latestRun ? (
          <p className="text-xs text-stone">No reports have been sent yet.</p>
        ) : (
          <div className="space-y-1.5 text-xs text-bark">
            <div className="flex items-center gap-2">
              <RunStatusBadge status={latestRun.status} />
              <span>
                {new Date(latestRun.started_at).toLocaleString("en-AU")} ({latestRun.trigger})
              </span>
            </div>
            {latestRun.payload && (
              <p>
                Sent to {String(latestRun.payload.recipient ?? "—")} ·{" "}
                {String(latestRun.payload.needs_attention_count ?? 0)} needing a decision ·{" "}
                {String(latestRun.payload.failures_count ?? 0)} failed writes
              </p>
            )}
            {latestRun.error && <p className="text-blaze">{latestRun.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Marketer fill

interface MarketerSettings {
  key: string;
  name: string;
  enabled: boolean;
  mode: "dry_run" | "apply";
  config: {
    schedule: StoredSchedule;
    assignable_state_codes: string[];
    customer_group_codes: string[];
    marketer_entity_code: string;
    discovery_lookback_days: number;
    discovery_horizon_days: number;
  };
}

interface MarketerOverview {
  process: { key: string; name: string; enabled: boolean; mode: string } | null;
  latestRun: (RunRow & { payload: Record<string, unknown> | null }) | null;
  scope: {
    groups: Array<{ code: string; name: string; customerCount: number }>;
    customers: string[];
    marketer: { code: string; name: string };
  } | null;
  scopeError: string | null;
}

interface MarketerActivityRow {
  id: string;
  target_ref: string | null;
  consignee_name: string | null;
  action: string;
  status: "proposed" | "applied" | "skipped" | "failed";
  skip_reason: string | null;
  after: { code?: string; marketer_ft_id?: string | null } | null;
  error: string | null;
  created_at: string;
}

/**
 * The Woolworths marketer fill (process marketer_auto_fill): one tab holding
 * its status, who it covers, its settings and its activity, so it can be
 * switched off in one place once Woolworths EDI sends the marketer itself.
 */
function MarketerTab({ isHubAdmin }: { isHubAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [groupsDraft, setGroupsDraft] = useState<string | null>(null);
  const [marketerDraft, setMarketerDraft] = useState<string | null>(null);

  const settingsQ = useQuery<MarketerSettings>({
    queryKey: ["tools-marketer-settings"],
    queryFn: () => fetchJson<MarketerSettings>(`${MARKETER_BASE}/settings`),
  });
  const overviewQ = useQuery<MarketerOverview>({
    queryKey: ["tools-marketer-overview"],
    queryFn: () => fetchJson<MarketerOverview>(`${MARKETER_BASE}/overview`),
    refetchInterval: 30000,
  });
  const activityQ = useQuery<MarketerActivityRow[]>({
    queryKey: ["tools-marketer-activity", statusFilter],
    queryFn: () =>
      fetchJson<MarketerActivityRow[]>(
        `${MARKETER_BASE}/activity${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
      ),
  });
  const { data: orderStates } = useQuery<OrderStateOption[]>({
    queryKey: ["tools-consignor-order-states"],
    queryFn: () => safeFetch<OrderStateOption[]>(`${BASE}/order-states`),
    staleTime: 5 * 60 * 1000,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["tools-marketer-settings"] });
    queryClient.invalidateQueries({ queryKey: ["tools-marketer-overview"] });
    queryClient.invalidateQueries({ queryKey: ["tools-marketer-activity"] });
  };

  const patchMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`${MARKETER_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update settings");
      }
      return res.json();
    },
    onSuccess: () => {
      setGroupsDraft(null);
      setMarketerDraft(null);
      refreshAll();
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(MARKETER_RUN_URL, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Run failed");
      if (body.status === "failed") throw new Error(body.error || "Run failed");
      return body;
    },
    onSettled: refreshAll,
  });

  const undoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${MARKETER_BASE}/activity/${id}/undo`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to undo");
      }
    },
    onSettled: refreshAll,
  });

  if (settingsQ.isLoading) return <Skeleton className="mt-4 h-[320px] rounded-xl" />;
  if (settingsQ.error || !settingsQ.data) {
    return (
      <PanelError
        className="mt-4"
        label={settingsQ.error?.message ?? "Failed to load the marketer fill — try refreshing"}
      />
    );
  }

  const settings = settingsQ.data;
  const cfg = settings.config;
  const overview = overviewQ.data;
  const run = overview?.latestRun ?? null;
  const live = settings.mode === "apply";
  const rows = activityQ.data ?? [];
  const groupsValue = groupsDraft ?? cfg.customer_group_codes.join(", ");
  const marketerValue = marketerDraft ?? cfg.marketer_entity_code;

  const saveConfig = (next: Partial<MarketerSettings["config"]>) =>
    patchMutation.mutate({ config: { ...cfg, ...next } });

  function toggleState(code: string) {
    const next = cfg.assignable_state_codes.includes(code)
      ? cfg.assignable_state_codes.filter((c) => c !== code)
      : [...cfg.assignable_state_codes, code];
    saveConfig({ assignable_state_codes: next });
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-sand bg-cream px-4 py-3 text-xs text-bark">
        Fills a <strong>blank</strong> marketer with {overview?.scope?.marketer.name ?? cfg.marketer_entity_code} on
        open orders for the customers below, so manually imported Woolworths POs reach the Orders portal. It never
        changes a marketer that is already set. Meant as a bridge until Woolworths EDI sends the marketer —
        pause it then.
      </div>

      {/* Status */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-soil">Status</span>
            <Badge
              variant={live ? "default" : "secondary"}
              className={live ? "bg-canopy" : "bg-harvest/20 text-harvest"}
            >
              {live ? "Live" : "Dry run"}
            </Badge>
            {!settings.enabled && (
              <Badge variant="outline" className="border-stone text-stone">
                Off
              </Badge>
            )}
          </div>
          {isHubAdmin && (
            <Button
              size="sm"
              className="bg-canopy text-white hover:bg-canopy/90"
              disabled={runMutation.isPending || !settings.enabled}
              onClick={() => runMutation.mutate()}
              title={!settings.enabled ? "Turn the fill on below first" : undefined}
            >
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Run now
            </Button>
          )}
        </div>
        {runMutation.isError && <p className="mb-3 text-xs text-blaze">{runMutation.error?.message}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Blank marketers found" value={run?.candidates_seen ?? 0} />
          <StatCard
            label={run?.mode === "apply" ? "Filled" : "Would fill"}
            value={run?.mode === "apply" ? (run?.actions_applied ?? 0) : (run?.actions_proposed ?? 0)}
            tone="success"
          />
          <StatCard label="Skipped" value={run?.actions_skipped ?? 0} />
          <StatCard label="Failed" value={run?.actions_failed ?? 0} tone={run && run.actions_failed > 0 ? "danger" : undefined} />
        </div>
        <div className="mt-4 space-y-1.5 border-t border-sand pt-3 text-xs text-bark">
          {run ? (
            <p>
              Last run {new Date(run.started_at).toLocaleString("en-AU")} ({run.trigger},{" "}
              {run.mode === "apply" ? "live" : "dry run"}, {run.status})
            </p>
          ) : (
            <p>No runs yet.</p>
          )}
          {run?.error && <p className="text-blaze">{run.error}</p>}
          {typeof run?.payload?.warning === "string" && <p className="text-harvest">{run.payload.warning}</p>}
          {run?.payload?.discovery_limit_hit === true && (
            <p className="text-harvest">This run hit its order limit — some orders may wait for the next run.</p>
          )}
        </div>
      </div>

      {/* Who it covers */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <h3 className="mb-2 text-sm font-semibold text-soil">Who it covers</h3>
        {overviewQ.isLoading ? (
          <Skeleton className="h-12 rounded-lg" />
        ) : overview?.scopeError ? (
          <p className="flex items-center gap-2 text-xs text-blaze">
            <XCircle className="h-3.5 w-3.5" />
            {overview.scopeError}
          </p>
        ) : overview?.scope ? (
          <div className="space-y-1.5 text-xs text-bark">
            {overview.scope.groups.map((g) => (
              <p key={g.code}>
                <span className="font-medium text-soil">{g.name}</span> ({g.code}) — {g.customerCount} customers
              </p>
            ))}
            <p className="text-stone">{overview.scope.customers.join(" · ")}</p>
            <p>
              Marketer written: <span className="font-medium text-soil">{overview.scope.marketer.name}</span> (
              {overview.scope.marketer.code})
            </p>
          </div>
        ) : null}
      </div>

      {/* Settings */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        {!isHubAdmin && (
          <p className="mb-4 rounded-lg bg-cream px-3 py-2 text-xs text-bark">
            Read-only — changing these settings requires Hub Admin.
          </p>
        )}

        <Row label="Mode" hint={live ? "Writes to FreshTrack" : "Proposes only — writes nothing"}>
          <select
            aria-label="Marketer fill mode"
            disabled={!isHubAdmin || patchMutation.isPending}
            value={settings.mode}
            onChange={(e) => {
              const mode = e.target.value;
              if (mode === "apply" && !confirm("Switch the marketer fill to live? It will start writing the marketer to FreshTrack orders.")) return;
              patchMutation.mutate({ mode });
            }}
            className="h-9 w-[160px] rounded-lg border border-sand bg-white px-2 text-sm disabled:opacity-60"
          >
            <option value="dry_run">Dry run</option>
            <option value="apply">Apply</option>
          </select>
        </Row>

        <ScheduleField
          label="Run at"
          schedule={cfg.schedule}
          disabled={!isHubAdmin || patchMutation.isPending}
          onChange={(schedule) => saveConfig({ schedule })}
        />

        <Row
          label="Customer groups"
          hint="Parent customer codes in FreshTrack. Every customer under them is covered. WOWGL = Woolworths."
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label="Customer groups"
              value={groupsValue}
              disabled={!isHubAdmin}
              onChange={(e) => setGroupsDraft(e.target.value)}
              className="h-9 w-[180px] border-sand bg-white"
            />
            {isHubAdmin && groupsDraft !== null && (
              <Button
                size="sm"
                variant="outline"
                disabled={patchMutation.isPending}
                onClick={() => saveConfig({ customer_group_codes: groupsValue.split(",").map((c) => c.trim()) })}
              >
                Save
              </Button>
            )}
          </div>
        </Row>

        <Row label="Marketer to fill in" hint="Entity code in FreshTrack. MACKM = Mackays Marketing.">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Marketer code"
              value={marketerValue}
              disabled={!isHubAdmin}
              onChange={(e) => setMarketerDraft(e.target.value)}
              className="h-9 w-[180px] border-sand bg-white"
            />
            {isHubAdmin && marketerDraft !== null && (
              <Button
                size="sm"
                variant="outline"
                disabled={patchMutation.isPending}
                onClick={() => saveConfig({ marketer_entity_code: marketerValue })}
              >
                Save
              </Button>
            )}
          </div>
        </Row>

        <div className="border-b border-sand py-3.5">
          <p className="text-sm text-soil">Order states</p>
          <p className="mb-2.5 text-xs text-stone">
            Only orders in a ticked state are filled. Looks at orders due from{" "}
            {cfg.discovery_lookback_days} days ago to {cfg.discovery_horizon_days} days ahead.
          </p>
          {!orderStates ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {orderStates.map((state) => (
                <label
                  key={state.code}
                  className={`flex items-center gap-2 text-xs ${isHubAdmin ? "cursor-pointer text-bark" : "text-stone"}`}
                >
                  <input
                    type="checkbox"
                    checked={cfg.assignable_state_codes.includes(state.code)}
                    disabled={!isHubAdmin || patchMutation.isPending}
                    onChange={() => toggleState(state.code)}
                    className="h-3.5 w-3.5 rounded border-sand accent-canopy disabled:opacity-60"
                  />
                  <span className="font-mono text-[11px] text-stone">{state.code}</span>
                  {state.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4">
          <div>
            <p className={`text-sm font-medium ${settings.enabled ? "text-blaze" : "text-canopy"}`}>
              {settings.enabled ? "Turn the fill off" : "Turn the fill on"}
            </p>
            <p className="text-xs text-bark">
              {settings.enabled
                ? "Stops all scheduled and on-demand runs straight away."
                : "Off — nothing runs until it is turned on."}
            </p>
          </div>
          {isHubAdmin && (
            <Button
              size="sm"
              variant="outline"
              className={settings.enabled ? "border-blaze/40 text-blaze" : "border-canopy/40 text-canopy"}
              disabled={patchMutation.isPending}
              onClick={() => patchMutation.mutate({ enabled: !settings.enabled })}
            >
              {settings.enabled ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
        {patchMutation.isError && <p className="mt-3 text-xs text-blaze">{patchMutation.error?.message}</p>}
      </div>

      {/* Activity */}
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(["all", "applied", "proposed", "skipped", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s ? "bg-forest text-white" : "bg-sand/60 text-bark hover:bg-sand"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {undoMutation.isError && <p className="text-xs text-blaze">{undoMutation.error?.message}</p>}
        {activityQ.isLoading ? (
          <Skeleton className="h-[240px] rounded-xl" />
        ) : activityQ.error ? (
          <PanelError label="Failed to load activity — try refreshing" />
        ) : (
          <div className="rounded-xl border border-sand bg-warmwhite">
            <Table>
              <TableHeader>
                <TableRow className="border-sand hover:bg-transparent">
                  <TableHead className="text-xs text-stone">Order</TableHead>
                  <TableHead className="text-xs text-stone">Customer</TableHead>
                  <TableHead className="text-xs text-stone">Status</TableHead>
                  <TableHead className="text-xs text-stone">Detail</TableHead>
                  <TableHead className="text-xs text-stone">When</TableHead>
                  {isHubAdmin && <TableHead className="w-[90px] text-xs text-stone"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-stone">
                      No activity yet
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} className="border-sand/50">
                      <TableCell className="font-mono text-xs text-soil">{row.target_ref ?? "—"}</TableCell>
                      <TableCell className="text-bark">{row.consignee_name ?? "—"}</TableCell>
                      <TableCell>
                        <ActivityStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-bark">
                        {row.action === "clear_marketer"
                          ? row.status === "applied"
                            ? "Undone — marketer back to blank"
                            : (row.error ?? "Undo failed")
                          : row.status === "applied" || row.status === "proposed"
                            ? `→ ${row.after?.code ?? "—"}`
                            : row.status === "failed"
                              ? (row.error ?? "—")
                              : reasonLabel(row.skip_reason)}
                      </TableCell>
                      <TableCell className="text-xs text-bark">
                        {new Date(row.created_at).toLocaleString("en-AU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      {isHubAdmin && (
                        <TableCell>
                          {row.status === "applied" && row.action === "set_marketer" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={undoMutation.isPending}
                              onClick={() => {
                                const note = settings.enabled
                                  ? "\n\nThe fill is on, so its next run will fill it again. Turn the fill off first if it should stay blank."
                                  : "";
                                if (confirm(`Set the marketer on order ${row.target_ref} back to blank?${note}`)) {
                                  undoMutation.mutate(row.id);
                                }
                              }}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Undo
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-sand py-3.5 last:border-0">
      <div>
        <p className="text-sm text-soil">{label}</p>
        {hint && <p className="text-xs text-stone">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
