"use client";

import type { ReactElement } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change: number;
  icon: ReactElement;
  color: string;
}

export function StatCard({ title, value, change, icon, color }: StatCardProps) {
  const isPositive = change >= 0;

  return (
    <div className="rounded-xl border border-sand bg-warmwhite p-5">
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <span className="text-sm text-stone">{title}</span>
      </div>
      <div className="mt-2 font-mono text-2xl font-bold text-soil">{value}</div>
      <div className="mt-2">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            isPositive
              ? "bg-canopy/10 text-canopy"
              : "bg-blaze/10 text-blaze"
          }`}
        >
          {isPositive ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          {isPositive ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
