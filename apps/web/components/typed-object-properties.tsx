"use client";

import { useState } from "react";

type PropType = "text" | "number" | "date" | "select" | "multi-select" | "url" | "relation";

interface PropDef {
  type: PropType;
  options?: string[];
}

interface SchemaJson {
  properties?: Record<string, PropDef>;
}

interface Props {
  objectId: string;
  schema: SchemaJson;
  data: Record<string, unknown>;
  onSaved?: (property: string, value: unknown) => void;
}

function parseSchema(s: unknown): SchemaJson {
  if (!s || typeof s !== "object") return {};
  const obj = s as Record<string, unknown>;
  if (!obj.properties || typeof obj.properties !== "object") return {};
  return s as SchemaJson;
}

async function patchProperty(objectId: string, property: string, value: unknown): Promise<void> {
  const res = await fetch(`/api/typed-objects/${objectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property, value }),
  });
  if (!res.ok) {
    const d = await res.json() as { error?: string };
    throw new Error(d.error ?? "Save failed");
  }
}

function TextField({
  name, initial, objectId, onSaved,
}: { name: string; initial: string; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    try {
      await patchProperty(objectId, name, val);
      setErr(null);
      onSaved?.(name, val);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        className="rounded border border-input bg-background px-2 py-1 text-sm w-full"
        aria-label={name}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function NumberField({
  name, initial, objectId, onSaved,
}: { name: string; initial: string; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const num = val === "" ? null : Number(val);
    if (val !== "" && isNaN(num as number)) { setErr("Must be a number"); return; }
    try {
      await patchProperty(objectId, name, num);
      setErr(null);
      onSaved?.(name, num);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        className="rounded border border-input bg-background px-2 py-1 text-sm w-full"
        aria-label={name}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function DateField({
  name, initial, objectId, onSaved,
}: { name: string; initial: string; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    try {
      await patchProperty(objectId, name, val || null);
      setErr(null);
      onSaved?.(name, val || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="date"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void save()}
        className="rounded border border-input bg-background px-2 py-1 text-sm"
        aria-label={name}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function SelectField({
  name, initial, options, objectId, onSaved,
}: { name: string; initial: string; options: string[]; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string) {
    setVal(next);
    try {
      await patchProperty(objectId, name, next || null);
      setErr(null);
      onSaved?.(name, next || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={val}
        onChange={(e) => void save(e.target.value)}
        className="rounded border border-input bg-background px-2 py-1 text-sm"
        aria-label={name}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function MultiSelectField({
  name, initial, options, objectId, onSaved,
}: { name: string; initial: string[]; options: string[]; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState<string[]>(initial);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(opt: string) {
    const next = val.includes(opt) ? val.filter((v) => v !== opt) : [...val, opt];
    setVal(next);
    try {
      await patchProperty(objectId, name, next);
      setErr(null);
      onSaved?.(name, next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => void toggle(o)}
            className={`rounded-full px-2 py-0.5 text-xs border ${
              val.includes(o)
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input text-muted-foreground hover:border-primary"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function UrlField({
  name, initial, objectId, onSaved,
}: { name: string; initial: string; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    try {
      await patchProperty(objectId, name, val || null);
      setErr(null);
      onSaved?.(name, val || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="url"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        className="rounded border border-input bg-background px-2 py-1 text-sm w-full"
        placeholder="https://…"
        aria-label={name}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function RelationField({
  name, initial, objectId, onSaved,
}: { name: string; initial: string; objectId: string; onSaved?: (p: string, v: unknown) => void }) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    try {
      await patchProperty(objectId, name, val || null);
      setErr(null);
      onSaved?.(name, val || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        {val ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs">
            {val}
            <button
              onClick={() => { setVal(""); void save(); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear relation"
            >×</button>
          </span>
        ) : null}
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          placeholder="Object ID or title…"
          className="rounded border border-input bg-background px-2 py-1 text-sm flex-1"
          aria-label={name}
        />
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

export function TypedObjectProperties({ objectId, schema: rawSchema, data, onSaved }: Props) {
  const schema = parseSchema(rawSchema);
  const properties = schema.properties ?? {};

  if (Object.keys(properties).length === 0) {
    return <p className="text-sm text-muted-foreground">No properties defined for this kind.</p>;
  }

  return (
    <dl className="space-y-4">
      {Object.entries(properties).map(([name, def]) => {
        const raw = data[name];
        return (
          <div key={name}>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {name}
            </dt>
            <dd>
              {def.type === "text" && (
                <TextField
                  name={name}
                  initial={typeof raw === "string" ? raw : ""}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "number" && (
                <NumberField
                  name={name}
                  initial={raw != null ? String(raw) : ""}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "date" && (
                <DateField
                  name={name}
                  initial={typeof raw === "string" ? raw : ""}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "select" && (
                <SelectField
                  name={name}
                  initial={typeof raw === "string" ? raw : ""}
                  options={def.options ?? []}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "multi-select" && (
                <MultiSelectField
                  name={name}
                  initial={Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []}
                  options={def.options ?? []}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "url" && (
                <UrlField
                  name={name}
                  initial={typeof raw === "string" ? raw : ""}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
              {def.type === "relation" && (
                <RelationField
                  name={name}
                  initial={typeof raw === "string" ? raw : ""}
                  objectId={objectId}
                  onSaved={onSaved}
                />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export { parseSchema };
