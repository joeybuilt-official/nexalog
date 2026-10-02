// SPDX-License-Identifier: MIT
/**
 * /api/ai/inline — one inline block-edit command over one block of note text.
 *
 * BOTH editor surfaces have always called this route and it was never written: the
 * web slash menu (`components/editor/slash-extension.ts`) and the native note editor
 * (`mobile/lib/src/features/notes/wysiwyg_note_editor.dart`) each POST
 * `{ command, blockText }` and read `{ result }`. The contract below is that existing
 * one, so neither client changes — this route is what was missing.
 *
 * The rule lives in `lib/ai/inline.ts` (pure, port-injected) and the prompts in
 * `lib/intelligence/prompts.ts` (versioned configuration). This handler does only
 * what a handler should: authenticate, validate, resolve the port, translate the
 * result into a status code.
 *
 * WHY EACH FAILURE IS ITS OWN STATUS
 * ----------------------------------
 * - 400 `unknown_command` / `empty_block`: the caller sent something this endpoint
 *   does not accept. `command` is a closed set, not a prompt, so an unrecognized
 *   value is refused instead of being forwarded to the model.
 * - 503 `model_unconfigured`: this deployment has no model key. A distinct code, not
 *   a 500, because it is an expected standalone state (Plexo is optional, ADR-0017)
 *   and the client should say so rather than show a crash.
 * - 502 `model_failed` / `empty_output`: the model leg was configured and did not
 *   produce text. Never a 200 with an empty `result`, which would blank the user's
 *   paragraph on a successful-looking response.
 *
 * No body is ever persisted: this is a stateless text transform the caller applies
 * itself, so there is nothing to write and no provenance row to keep.
 */

import { z } from "zod";
import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { resolveIntelligence } from "@/lib/intelligence/resolve";
import {
  isInlineCommand,
  normalizeBlockText,
  runInlineCommand,
} from "@/lib/ai/inline";

const bodySchema = z.object({
  command: z.string(),
  blockText: z.string(),
});

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!isInlineCommand(parsed.command)) {
    return Response.json({ error: "unknown_command" }, { status: 400 });
  }

  const blockText = normalizeBlockText(parsed.blockText);
  if (!blockText) {
    return Response.json({ error: "empty_block" }, { status: 400 });
  }

  const result = await runInlineCommand(parsed.command, blockText, {
    intelligence: resolveIntelligence(),
    signal: request.signal,
    log: logEvent,
  });

  if (!result.ok) {
    if (result.reason === "model_unconfigured") {
      return Response.json({ error: "model_unconfigured" }, { status: 503 });
    }
    return Response.json({ error: result.reason }, { status: 502 });
  }

  // The client reads `result`; the rest is metadata a caller may ignore. `mode`
  // tells it whether to replace the block or insert below (`related` inserts).
  return Response.json({
    result: result.text,
    model: result.model,
    promptVersion: result.promptVersion,
    mode: result.mode,
  });
}
