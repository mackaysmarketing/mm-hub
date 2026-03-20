import { cn } from "@/lib/utils";

type SkeletonVariant = "stat" | "chart" | "table" | "list";

interface SkeletonCardProps {
  variant?: SkeletonVariant;
  lines?: number;
  showIcon?: boolean;
  className?: string;
}

function PulseBar({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded bg-sand/70", className)}
    />
  );
}

export function SkeletonCard({
  variant = "list",
  lines = 3,
  showIcon = false,
  className,
}: SkeletonCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-sand bg-warmwhite p-5",
        className
      )}
    >
      {variant === "stat" && (
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <PulseBar className="h-3 w-20" />
            <PulseBar className="h-7 w-28" />
            <PulseBar className="h-3 w-16" />
          </div>
          {showIcon && <PulseBar className="h-10 w-10 rounded-lg" />}
        </div>
      )}

      {variant === "chart" && (
        <div className="space-y-3">
          <PulseBar className="h-3 w-32" />
          <PulseBar className="h-[250px] w-full rounded-lg" />
        </div>
      )}

      {variant === "table" && (
        <div className="space-y-3">
          <PulseBar className="h-3 w-32" />
          <PulseBar className="h-8 w-full" />
          {Array.from({ length: lines }).map((_, i) => (
            <PulseBar key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-3">
          {showIcon && <PulseBar className="h-8 w-8 rounded-lg" />}
          {Array.from({ length: lines }).map((_, i) => {
            const widths = ["w-full", "w-4/5", "w-3/5", "w-2/5", "w-1/2"];
            return (
              <PulseBar
                key={i}
                className={cn("h-4", widths[i % widths.length])}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
