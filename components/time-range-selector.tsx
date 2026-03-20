"use client";

const OPTIONS = ["4W", "12W", "26W", "52W"] as const;

interface TimeRangeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt
              ? "bg-soil text-warmwhite"
              : "bg-cream text-bark hover:bg-sand"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
