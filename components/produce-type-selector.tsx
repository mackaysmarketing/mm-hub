"use client";

interface ProduceType {
  id: string;
  label: string;
  color: string;
}

interface ProduceTypeSelectorProps {
  types: ProduceType[];
  selected: string;
  onChange: (value: string) => void;
}

export function ProduceTypeSelector({
  types,
  selected,
  onChange,
}: ProduceTypeSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onChange("all")}
        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
          selected === "all"
            ? "bg-soil text-warmwhite"
            : "bg-cream text-bark hover:bg-sand"
        }`}
      >
        All
      </button>
      {types.map((type) => (
        <button
          key={type.id}
          onClick={() => onChange(type.id)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            selected === type.id
              ? "bg-soil text-warmwhite"
              : "bg-cream text-bark hover:bg-sand"
          }`}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: type.color }}
          />
          {type.label}
        </button>
      ))}
    </div>
  );
}
