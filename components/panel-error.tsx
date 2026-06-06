"use client";

import { AlertCircle } from "lucide-react";

/**
 * Uniform error fallback for a panel/section that failed to load. Surfaces a
 * failed fetch (5xx / 403 / network) so it's visually distinct from an empty
 * state — closes review finding UI-AC-5 ("failed fetches render as empty/zero,
 * masking outages").
 */
export function PanelError({
  label = "Failed to load this section",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border border-blaze/20 bg-blaze/5 py-10 text-blaze ${className}`}
    >
      <AlertCircle className="h-6 w-6" />
      <p className="text-xs">{label}</p>
    </div>
  );
}
