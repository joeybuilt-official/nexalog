// SPDX-License-Identifier: MIT

/**
 * The client-side call for a project's brief, kept in the owning feature module
 * rather than in a component body (`.claude/rules/frontend.md`: never call the
 * raw HTTP primitive from a component). The response type is imported from the
 * pure module, so the wire shape and the server's type cannot drift.
 */

import type { ProjectBrief } from "./brief";

export class BriefRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BriefRequestError";
    this.status = status;
  }
}

function briefUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/brief`;
}

/**
 * Read or regenerate a project's brief.
 *
 * `GET` reads the current brief; `POST` asks for a fresh synthesis. Nothing is
 * persisted, so every response is computed on demand — the two verbs differ in
 * INTENT, not in caching, and the UI uses POST for "Regenerate".
 */
export async function requestProjectBrief(
  projectId: string,
  options: { method?: "GET" | "POST"; signal?: AbortSignal } = {},
): Promise<ProjectBrief> {
  const response = await fetch(briefUrl(projectId), {
    method: options.method ?? "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    throw new BriefRequestError(response.status, `brief request failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as { brief?: ProjectBrief } | null;
  if (!payload || !payload.brief) {
    throw new BriefRequestError(response.status, "brief response was missing its payload");
  }
  return payload.brief;
}
