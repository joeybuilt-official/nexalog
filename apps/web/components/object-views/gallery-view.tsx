"use client";

import { useRouter } from "next/navigation";

type Kind = { workspaceId: string; kind: string; icon: string | null; schemaJson: Record<string, unknown> };
type Obj = { id: string; kind: string; data: Record<string, unknown>; createdAt: string };

interface SchemaJson {
  properties?: Record<string, { type: string }>;
}

function firstNonTitleValue(data: Record<string, unknown>, schema: SchemaJson): string {
  const props = Object.entries(schema.properties ?? {});
  for (const [name] of props) {
    if (name === "title") continue;
    const v = data[name];
    if (v != null && v !== "") return String(v);
  }
  return "";
}

interface GalleryViewProps {
  objects: Obj[];
  kinds: Kind[];
  activeKind: string;
}

export function GalleryView({ objects, kinds, activeKind }: GalleryViewProps) {
  const router = useRouter();
  const kindDef = kinds.find((k) => k.kind === activeKind);
  const schema = (kindDef?.schemaJson ?? {}) as SchemaJson;
  const icon = kindDef?.icon ?? "📄";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {objects.map((obj) => {
        const subtitle = firstNonTitleValue(obj.data, schema) || new Date(obj.createdAt).toLocaleDateString();
        return (
          <div
            key={obj.id}
            className="rounded-lg border p-3 flex flex-col gap-1 hover:bg-accent/30 cursor-pointer"
            onClick={() => router.push(`/app/objects/${obj.id}`)}
          >
            <span className="text-2xl">{icon}</span>
            <p className="font-medium text-sm truncate">
              {String(obj.data.title ?? "(Untitled)")}
            </p>
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          </div>
        );
      })}
    </div>
  );
}
