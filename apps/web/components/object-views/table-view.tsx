"use client";

import { useRouter } from "next/navigation";

type Kind = { workspaceId: string; kind: string; icon: string | null; schemaJson: Record<string, unknown> };
type Obj = { id: string; kind: string; data: Record<string, unknown>; createdAt: string };

interface SchemaJson {
  properties?: Record<string, { type: string; options?: string[] }>;
}

function displayValue(raw: unknown, type: string): string {
  if (raw == null) return "—";
  if (type === "multi-select" && Array.isArray(raw)) return raw.join(", ");
  if (type === "date" && typeof raw === "string") return raw;
  return String(raw);
}

interface TableViewProps {
  objects: Obj[];
  kinds: Kind[];
  activeKind: string;
}

export function TableView({ objects, kinds, activeKind }: TableViewProps) {
  const router = useRouter();
  const kindDef = kinds.find((k) => k.kind === activeKind);
  const schema = (kindDef?.schemaJson ?? {}) as SchemaJson;
  const props = Object.entries(schema.properties ?? {});

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium text-muted-foreground">Title</th>
            {props.map(([name]) => (
              <th key={name} className="py-2 pr-4 font-medium text-muted-foreground capitalize">
                {name}
              </th>
            ))}
            <th className="py-2 font-medium text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {objects.map((obj) => (
            <tr
              key={obj.id}
              className="border-b hover:bg-accent/30 cursor-pointer"
              onClick={() => router.push(`/app/objects/${obj.id}`)}
            >
              <td className="py-2 pr-4 font-medium">
                {String(obj.data.title ?? "(Untitled)")}
              </td>
              {props.map(([name, def]) => (
                <td key={name} className="py-2 pr-4 text-muted-foreground">
                  {displayValue(obj.data[name], def.type)}
                </td>
              ))}
              <td className="py-2 text-muted-foreground">
                {new Date(obj.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
