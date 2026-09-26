"use client";

export type ViewType = "table" | "gallery" | "board" | "calendar";

const VIEWS: { value: ViewType; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "gallery", label: "Gallery" },
  { value: "board", label: "Board" },
  { value: "calendar", label: "Calendar" },
];

interface ViewSwitcherProps {
  value: ViewType;
  onChange: (v: ViewType) => void;
}

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  return (
    <div className="inline-flex rounded-md border border-input bg-background p-0.5 gap-0.5">
      {VIEWS.map((v) => (
        <button
          key={v.value}
          onClick={() => onChange(v.value)}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            value === v.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
