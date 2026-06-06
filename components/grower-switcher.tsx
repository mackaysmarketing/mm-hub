"use client";

interface GrowerInfo {
  id: string;
  name: string;
  code: string | null;
}

interface GrowerSwitcherProps {
  growers: GrowerInfo[];
  selectedGrowerId: string | null;
  onChange: (growerId: string | null) => void;
}

/**
 * Farm selector for the grower portal. Per spec:
 *   * hidden entirely when the caller has exactly 1 farm
 *   * defaults to "All Farms" when >1, and the caller's choice persists across
 *     navigations (the hook handles that via localStorage keyed by group)
 */
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
      aria-label="Select farm"
    >
      <option value="">All Farms</option>
      {growers.map((farm) => (
        <option key={farm.id} value={farm.id}>
          {farm.name}
          {farm.code ? ` (${farm.code})` : ""}
        </option>
      ))}
    </select>
  );
}
