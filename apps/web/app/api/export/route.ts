import { Readable } from "node:stream";
import { getAuthUser } from "@/lib/auth/server";
import { loadExportBundle } from "@/lib/export/load";
import { buildExportArchive } from "@/lib/export/build-archive";
import { exportFilename } from "@/lib/export/slug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const bundle = await loadExportBundle(user.id);
  const archive = buildExportArchive(bundle);
  // Readable.toWeb() is the standard adapter; archiver pushes chunks as it
  // compresses, so the response body streams rather than buffers.
  const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  const filename = exportFilename(user.id, bundle.exportedAt);

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
