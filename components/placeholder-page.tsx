import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  LineChart,
  Users,
  ClipboardCheck,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  LineChart,
  Users,
  ClipboardCheck,
  RefreshCw,
  Settings,
};

interface PlaceholderPageProps {
  title: string;
  icon: string;
  phase: string;
}

export function PlaceholderPage({ title, icon, phase }: PlaceholderPageProps) {
  const Icon = ICON_MAP[icon];

  return (
    <div className="rounded-xl border border-sand bg-warmwhite p-8">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        {Icon && <Icon size={48} className="mb-4 text-clay" />}
        <h1 className="font-display text-xl text-forest">{title}</h1>
        <p className="mt-2 text-sm text-stone">Coming in {phase}</p>
      </div>
    </div>
  );
}
