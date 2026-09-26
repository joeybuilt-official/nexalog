/**
 * POST /api/capture — the single intake endpoint (plan §1.8 / Phase 1).
 *
 * Accepts multipart form data (PWA share_target + bookmarklet + in-app):
 *   text   — a note or pasted text
 *   url    — a shared/clipped URL
 *   file[] — one or more attachments (audio normalized to opus, 25 MB cap)
 *   source — pwa-share | web | bookmarklet | mcp (default web)
 *
 * No business logic here: the handler only parses the request and calls the
 * CreateCapture use case from the composition root.
 */

import { NextRequest, NextResponse } from "next/server";
import { getComposition } from "@/composition";

export async function POST(req: NextRequest) {
  const { createCapture } = getComposition();

  try {
    const form = await req.formData();
    const text = form.get("text");
    const url = form.get("url");
    const sourceRaw = form.get("source");

    const files: Array<{ name: string; mimeType?: string; bytes: Uint8Array }> = [];
    for (const [key, value] of form.entries()) {
      if (key.startsWith("file") && value instanceof File) {
        const buf = new Uint8Array(await value.arrayBuffer());
        files.push({ name: value.name, mimeType: value.type || undefined, bytes: buf });
      }
    }

    const result = await createCapture.execute({
      text: typeof text === "string" ? text : undefined,
      url: typeof url === "string" ? url : undefined,
      source: (["pwa-share", "web", "bookmarklet", "mcp"] as const).includes(sourceRaw as never)
        ? (sourceRaw as "pwa-share" | "web" | "bookmarklet" | "mcp")
        : "web",
      files: files.length > 0 ? files : undefined,
    });

    return NextResponse.json({ ok: true, captureId: result.captureId.value }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "capture failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
