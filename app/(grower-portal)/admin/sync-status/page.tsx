"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface SyncLog {
  id: string;
  source: string;
  sync_type: string | null;
  status: string;
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SyncConfigRow {
  id: string;
  sync_source: string;
  step_order: number;
  source_view: string;
  target_table: string;
  enabled: boolean;
  description: string | null;
  field_mapping: Record<string, string>;
  transform_rules: Record<string, string>;
  dedup_column: string;
  grower_resolve_field: string | null;
}

interface SyncSummarySource {
  last_sync: SyncLog | null;
  last_success: SyncLog | null;
}

interface SyncData {
  logs: SyncLog[];
  config: SyncConfigRow[];
  summary: {
    freshtrack: SyncSummarySource;
    netsuite: SyncSummarySource;
  };
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function duration(started: string, completed: string | null): string {
  if (!completed) return "—";
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-canopy/10 px-2 py-0.5 text-xs font-medium text-canopy">
        <CheckCircle2 className="h-3 w-3" />
        Success
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-harvest/15 px-2 py-0.5 text-xs font-medium text-harvest">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blaze/10 px-2 py-0.5 text-xs font-medium text-blaze">
      <XCircle className="h-3 w-3" />
      Failed
    </span>
  );
}

function SyncCard({
  title,
  summary,
  onSync,
  syncing,
}: {
  title: string;
  summary: SyncSummarySource;
  onSync: () => void;
  syncing: boolean;
}) {
  const last = summary.last_sync;
  const lastSuccess = summary.last_success;

  return (
    <div className="rounded-xl border border-sand bg-warmwhite p-5">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-soil">{title}</h3>
        {last && <StatusBadge status={last.status} />}
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between text-bark">
          <span>Last sync:</span>
          <span className="text-soil">
            {last
              ? `${new Date(last.started_at).toLocaleString("en-AU")} (${relativeTime(last.started_at)})`
              : "Never"}
          </span>
        </div>
        <div className="flex justify-between text-bark">
          <span>Records synced:</span>
          <span className="font-mono text-soil">
            {last?.records_synced ?? "—"}
          </span>
        </div>
        {lastSuccess && lastSuccess.id !== last?.id && (
          <div className="flex justify-between text-bark">
            <span>Last success:</span>
            <span className="text-canopy">
              {relativeTime(lastSuccess.started_at)}
            </span>
          </div>
        )}
        {last?.status === "failed" && last.error_message && (
          <p className="mt-2 rounded bg-blaze/5 px-2 py-1.5 text-xs text-blaze">
            {last.error_message}
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="mt-4 border-sand text-bark"
        disabled={syncing}
        onClick={onSync}
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {syncing ? "Syncing..." : "Sync Now"}
      </Button>
    </div>
  );
}

export default function SyncStatusPage() {
  const queryClient = useQueryClient();
  const [logFilter, setLogFilter] = useState<"all" | "freshtrack" | "netsuite">("all");
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);

  const { data, isLoading } = useQuery<SyncData>({
    queryKey: ["admin-sync-status"],
    queryFn: () =>
      fetch("/api/grower-portal/admin/sync").then((r) => r.json()),
    refetchInterval: 30000, // refresh every 30s
  });

  const syncMutation = useMutation({
    mutationFn: async (source: "freshtrack" | "netsuite") => {
      const res = await fetch("/api/grower-portal/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sync-status"] });
    },
  });

  const [syncingSource, setSyncingSource] = useState<string | null>(null);

  async function handleSync(source: "freshtrack" | "netsuite") {
    setSyncingSource(source);
    try {
      await syncMutation.mutateAsync(source);
    } finally {
      setSyncingSource(null);
    }
  }

  const logs = data?.logs ?? [];
  const config = data?.config ?? [];

  const filteredLogs =
    logFilter === "all"
      ? logs
      : logs.filter((l) => l.source === logFilter);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <TopBar title="Sync Status" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TopBar title="Sync Status" />

      {/* Status cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SyncCard
          title="FreshTrack Sync"
          summary={data?.summary.freshtrack ?? { last_sync: null, last_success: null }}
          onSync={() => handleSync("freshtrack")}
          syncing={syncingSource === "freshtrack"}
        />
        <SyncCard
          title="NetSuite Sync"
          summary={data?.summary.netsuite ?? { last_sync: null, last_success: null }}
          onSync={() => handleSync("netsuite")}
          syncing={syncingSource === "netsuite"}
        />
      </div>

      {syncMutation.isError && (
        <p className="text-xs text-blaze">{syncMutation.error?.message}</p>
      )}

      {/* Sync history */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">Sync History</h2>
          <div className="flex gap-1">
            {(["all", "freshtrack", "netsuite"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLogFilter(tab)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  logFilter === tab
                    ? "bg-forest text-white"
                    : "bg-sand/60 text-bark hover:bg-sand"
                }`}
              >
                {tab === "all" ? "All" : tab === "freshtrack" ? "FreshTrack" : "NetSuite"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sand text-xs text-stone">
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Records</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-stone">
                    No sync logs
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-sand/50 last:border-0">
                    <td className="py-2 pr-4 text-xs font-medium text-soil capitalize">
                      {log.source}
                    </td>
                    <td className="py-2 pr-4 text-xs text-bark">
                      {log.sync_type ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-bark">
                      {log.records_synced}
                    </td>
                    <td className="py-2 pr-4 text-xs text-bark">
                      {new Date(log.started_at).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-bark">
                      {duration(log.started_at, log.completed_at)}
                    </td>
                    <td className="max-w-[200px] truncate py-2 text-xs text-blaze">
                      {log.error_message ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field mappings */}
      <div className="rounded-xl border border-sand bg-warmwhite p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-soil">Field Mappings</h2>
          <span className="text-[11px] text-stone">
            Edit mappings in Hub Admin
          </span>
        </div>

        <div className="space-y-2">
          {config.map((step) => {
            const isExpanded = expandedConfig === step.id;
            const mapping = step.field_mapping as Record<string, string>;
            const transforms = step.transform_rules as Record<string, string>;

            return (
              <div key={step.id} className="rounded-lg border border-sand/80">
                <button
                  onClick={() =>
                    setExpandedConfig(isExpanded ? null : step.id)
                  }
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-stone" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-stone" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-sand/60 px-1.5 py-0.5 font-mono text-[11px] text-bark">
                        {step.step_order}
                      </span>
                      <span className="text-xs text-bark">
                        {step.source_view}
                      </span>
                      <ArrowRight className="h-3 w-3 text-stone" />
                      <span className="text-xs font-medium text-soil">
                        {step.target_table}
                      </span>
                    </div>
                    {step.description && (
                      <p className="mt-0.5 text-[11px] text-stone">
                        {step.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      step.enabled
                        ? "bg-canopy/10 text-canopy"
                        : "bg-sand/60 text-stone"
                    }`}
                  >
                    {step.enabled ? "Enabled" : "Disabled"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-sand/80 px-4 py-3">
                    <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone">
                      Field Mapping
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {Object.entries(mapping).map(([src, tgt]) => (
                        <div
                          key={src}
                          className="col-span-2 grid grid-cols-2 gap-4"
                        >
                          <span className="font-mono text-[11px] text-bark">
                            {src}
                          </span>
                          <span className="font-mono text-[11px] text-soil">
                            {tgt}
                          </span>
                        </div>
                      ))}
                    </div>

                    {Object.keys(transforms).length > 0 && (
                      <>
                        <h4 className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wide text-stone">
                          Transform Rules
                        </h4>
                        {Object.entries(transforms).map(([field, rule]) => (
                          <div key={field} className="text-[11px]">
                            <span className="font-mono text-bark">{field}</span>
                            <span className="mx-1 text-stone">&rarr;</span>
                            <span className="text-harvest">{rule}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
