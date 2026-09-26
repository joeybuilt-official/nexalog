import { db, schema } from "@/lib/db";
import { eq, and, ne, desc } from "drizzle-orm";
import type { CaptureRow } from "@/components/capture-list";

export async function fetchCapturesByKind(
  workspaceId: string,
  kindClassified: "video" | "article" | "reference" | "homepage"
): Promise<CaptureRow[]> {
  const rows = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      ogTitle: schema.captureSources.ogTitle,
      urlHost: schema.captureSources.urlHost,
      createdAt: schema.captureSources.createdAt,
      stalenessScore: schema.captureSources.stalenessScore,
      evergreen: schema.captureSources.evergreen,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        eq(schema.captureSources.kindClassified, kindClassified),
        ne(schema.captureSources.state, "archived")
      )
    )
    .orderBy(desc(schema.captureSources.createdAt))
    .limit(200);

  return rows;
}
