"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = { workspaceId: string; kind: string; icon: string | null; schemaJson: Record<string, unknown> };
type Obj = { id: string; kind: string; data: Record<string, unknown>; createdAt: string };

interface SchemaJson {
  properties?: Record<string, { type: string }>;
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

interface CalendarViewProps {
  objects: Obj[];
  kinds: Kind[];
  activeKind: string;
}

export function CalendarView({ objects, kinds, activeKind }: CalendarViewProps) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const kindDef = kinds.find((k) => k.kind === activeKind);
  const schema = (kindDef?.schemaJson ?? {}) as SchemaJson;
  const dateProps = Object.entries(schema.properties ?? {}).filter(([, def]) => def.type === "date");
  const [dateProp, setDateProp] = useState<string>(dateProps[0]?.[0] ?? "");

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<string, Obj[]>();
  if (dateProp) {
    for (const obj of objects) {
      const raw = obj.data[dateProp];
      if (typeof raw !== "string" || !raw) continue;
      const d = raw.slice(0, 10);
      const [y, m, day] = d.split("-").map(Number);
      if (y === year && (m ?? 0) - 1 === month) {
        const key = String(day);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(obj);
      }
    }
  }

  if (dateProps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No date properties in this kind. Add a date property to use Calendar view.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="cal-prop" className="text-muted-foreground">Date field</label>
          <select
            id="cal-prop"
            value={dateProp}
            onChange={(e) => setDateProp(e.target.value)}
            className="rounded border border-input bg-background px-2 py-1 text-sm"
          >
            {dateProps.map(([name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={prevMonth}
            className="rounded border border-input px-2 py-1 text-sm hover:bg-accent"
          >←</button>
          <span className="text-sm font-medium w-36 text-center">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="rounded border border-input px-2 py-1 text-sm hover:bg-accent"
          >→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-l border-t">
        {DAY_NAMES.map((d) => (
          <div key={d} className="border-b border-r px-1 py-0.5 text-xs font-medium text-muted-foreground text-center bg-muted/30">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const items = day ? (byDay.get(String(day)) ?? []) : [];
          return (
            <div
              key={i}
              className="border-b border-r min-h-[72px] p-1 text-xs"
            >
              {day && (
                <>
                  <span className="text-muted-foreground">{day}</span>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {items.map((obj) => (
                      <button
                        key={obj.id}
                        onClick={() => router.push(`/app/objects/${obj.id}`)}
                        className="truncate rounded bg-primary/20 px-1 text-left hover:bg-primary/40 text-[11px]"
                      >
                        {String(obj.data.title ?? "(Untitled)")}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
