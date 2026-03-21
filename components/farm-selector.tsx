"use client";

import type { Farm } from "@/types/modules";

interface FarmSelectorProps {
  farms: Farm[];
  selectedFarmId: string | null;
  onChange: (farmId: string | null) => void;
}

export function FarmSelector({
  farms,
  selectedFarmId,
  onChange,
}: FarmSelectorProps) {
  if (farms.length <= 1) return null;

  return (
    <select
      value={selectedFarmId ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-md border border-sand bg-warmwhite px-3 py-1.5 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
    >
      <option value="">All farms</option>
      {farms.map((farm) => (
        <option key={farm.id} value={farm.id}>
          {farm.name}
          {farm.region ? ` — ${farm.region}` : ""}
        </option>
      ))}
    </select>
  );
}
