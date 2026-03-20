"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface SyncStatus {
  lastSync: string | null;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function getDotColor(dateStr: string): string {
  const mins = (Date.now() - new Date(dateStr).getTime()) / 60000;
  if (mins <= 30) return "bg-canopy";
  if (mins <= 60) return "bg-harvest";
  return "bg-blaze";
}

export function DataFreshnessBadge() {
  const { data } = useQuery<SyncStatus>({
    queryKey: ["data-freshness"],
    queryFn: () =>
      fetch("/api/sync-status/latest").then((r) => r.json()),
    refetchInterval: 60000,
  });

  if (!data?.lastSync) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-stone">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          getDotColor(data.lastSync)
        )}
      />
      <span>Data: {formatRelativeTime(data.lastSync)}</span>
    </div>
  );
}
