// SPDX-License-Identifier: MIT

/**
 * The client-side call for a project's brief, kept in the owning feature module
 * rather than in a component body (`.agents/rules/frontend.md`: never call the
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

/** The typed refusal a publish can produce, so the UI can explain it. */
export class BriefPublishRequestError extends BriefRequestError {
  /** The server's stable code (`brief_not_synthesized`, `gbrain_unavailable`, …). */
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null) {
    super(status, message);
    this.name = "BriefPublishRequestError";
    this.code = code;
  }
}

/** What a successful publish reports back. */
export interface BriefPublishOutcome {
  created: boolean;
  duplicate: boolean;
  proposalId: number;
  pageSlug: string;
  pageHref: string | null;
  provenance: {
    projectId: string;
    projectName: string;
    projectHref: string | null;
    pageSlug: string;
    modelId: string;
    generatedAt: string;
    promptVersion: string;
  };
}

/**
 * PUBLISH the brief — the explicit action. Never a side effect of reading one:
 * this is the only call in this module that writes anything anywhere.
 *
 * A 409 is the interesting failure and it is REPORTED, not swallowed: it means the
 * brief is a mechanical digest and the brain would not accept it as a claim. The
 * server's own `code` travels on the error so the UI can say why instead of
 * showing a generic failure.
 */
export async function publishProjectBrief(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<BriefPublishOutcome> {
  const response = await fetch(briefUrl(projectId), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ intent: "publish" }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const payload = (await response.json().catch(() => null)) as
    | (Partial<BriefPublishOutcome> & { error?: string; code?: string; message?: string })
    | null;

  if (!response.ok) {
    throw new BriefPublishRequestError(
      response.status,
      payload?.message ?? payload?.error ?? `publish failed (${response.status})`,
      payload?.code ?? payload?.error ?? null,
    );
  }

  if (!payload || typeof payload.proposalId !== "number" || !payload.provenance) {
    throw new BriefPublishRequestError(
      response.status,
      "publish response was missing its payload",
      null,
    );
  }

  return {
    created: Boolean(payload.created),
    duplicate: Boolean(payload.duplicate),
    proposalId: payload.proposalId,
    pageSlug: String(payload.pageSlug ?? ""),
    pageHref: payload.pageHref ?? null,
    provenance: payload.provenance,
  };
}
