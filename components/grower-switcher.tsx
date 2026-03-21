"use client";

interface GrowerInfo {
  id: string;
  name: string;
  code: string | null;
  region: string | null;
}

interface GrowerSwitcherProps {
  growers: GrowerInfo[];
  selectedGrowerId: string | null;
  onChange: (growerId: string | null) => void;
}

export function GrowerSwitcher({
  growers,
  selectedGrowerId,
  onChange,
}: GrowerSwitcherProps) {
  if (growers.length <= 1) return null;

  return (
    <select
      value={selectedGrowerId ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-md border border-sand bg-warmwhite px-3 py-1.5 text-sm text-soil focus:outline-none focus:ring-1 focus:ring-forest"
    >
      <option value="">All growers</option>
      {growers.map((grower) => (
        <option key={grower.id} value={grower.id}>
          {grower.name}
          {grower.region ? ` — ${grower.region}` : ""}
          {grower.code ? ` (${grower.code})` : ""}
        </option>
      ))}
    </select>
  );
}
