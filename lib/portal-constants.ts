/**
 * Shared constants and utilities for grower portal pages.
 * Centralises produce types, customer colours, and formatters to avoid duplication.
 */

// --- Produce types (brand-aligned colours) ---
export const PRODUCE_TYPES = [
  { id: "Banana", label: "Banana", color: "#E8B824" },
  { id: "Avocado", label: "Avocado", color: "#1A5C34" },
  { id: "Papaya", label: "Papaya", color: "#E05528" },
  { id: "Frozen Banana", label: "Frozen", color: "#1B3A5C" },
  { id: "Passionfruit", label: "Passionfruit", color: "#8B5CF6" },
];

// --- Customer colours (major retailers get fixed colours) ---
export const CUSTOMER_COLORS: Record<string, string> = {
  Coles: "#E50016",
  Woolworths: "#125B3C",
  ALDI: "#001E5E",
};
export const DEFAULT_CUSTOMER_COLOR = "#6B6760";

export function getCustomerColor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, color] of Object.entries(CUSTOMER_COLORS)) {
    if (lower.includes(key.toLowerCase())) return color;
  }
  return DEFAULT_CUSTOMER_COLOR;
}

// Stable palette for stacked bar chart segments
export const BAR_COLORS = [
  "#E50016", "#125B3C", "#001E5E", "#D4A017",
  "#6B6760", "#9C9690", "#C8302C", "#1B3A5C",
];

// --- Formatters ---

export function formatCurrency(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

export function formatCurrencyPrecise(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Number(v).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatWeight(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
  return `${Math.round(v)} kg`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-AU");
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

export function formatDateLong(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// --- Safe fetch for useQuery ---

export async function safeFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
