"use client";

import { useState } from "react";

type Kind = { workspaceId: string; kind: string; icon: string | null; schemaJson: Record<string, unknown> };
type Obj = { id: string; kind: string; data: Record<string, unknown>; createdAt: string };

interface SchemaJson {
  properties?: Record<string, { type: string; options?: string[] }>;
}

interface BoardViewProps {
  objects: Obj[];
  kinds: Kind[];
  activeKind: string;
}

export function BoardView({ objects: initialObjects, kinds, activeKind }: BoardViewProps) {
  const [objects, setObjects] = useState<Obj[]>(initialObjects);
  const kindDef = kinds.find((k) => k.kind === activeKind);
  const schema = (kindDef?.schemaJson ?? {}) as SchemaJson;
  const props = Object.entries(schema.properties ?? {});
  const selectProps = props.filter(([, def]) => def.type === "select");

  const [groupProp, setGroupProp] = useState<string>(selectProps[0]?.[0] ?? "");

  const groupDef = groupProp ? (schema.properties?.[groupProp] ?? null) : null;
  const columns = groupDef?.options ? ["", ...groupDef.options] : [""];

  async function move(objId: string, newVal: string) {
    await fetch(`/api/typed-objects/${objId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property: groupProp, value: newVal || null }),
    });
    setObjects((prev) =>
      prev.map((o) =>
        o.id === objId
          ? { ...o, data: { ...o.data, [groupProp]: newVal } }
          : o
      )
    );
  }

  if (selectProps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No select properties in this kind. Add a select property to use Board view.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="board-group" className="text-muted-foreground">Group by</label>
        <select
          id="board-group"
          value={groupProp}
          onChange={(e) => setGroupProp(e.target.value)}
          className="rounded border border-input bg-background px-2 py-1 text-sm"
        >
          {selectProps.map(([name]) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const colObjects = objects.filter((o) => {
            const v = o.data[groupProp];
            if (col === "") return v == null || v === "";
            return v === col;
          });
          return (
            <div key={col} className="flex flex-col gap-2 min-w-[200px] w-[200px] shrink-0">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {col || "None"}
              </h3>
              {colObjects.map((obj) => (
                <div key={obj.id} className="rounded-md border p-2 bg-background text-sm flex flex-col gap-1">
                  <p className="font-medium truncate">{String(obj.data.title ?? "(Untitled)")}</p>
                  {groupProp && (
                    <select
                      value={typeof obj.data[groupProp] === "string" ? (obj.data[groupProp] as string) : ""}
                      onChange={(e) => void move(obj.id, e.target.value)}
                      className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                      aria-label={`Move ${String(obj.data.title ?? obj.id)}`}
                    >
                      <option value="">None</option>
                      {groupDef?.options?.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
