// SPDX-License-Identifier: MIT
"use client";

// The project's BRIEF — a synthesized markdown summary of what this project is,
// its current state, its active threads, recent activity and open questions.
//
// The component renders and dispatches; it decides nothing. Whether a brief is a
// synthesis or a fallback, and what a fallback says, is the pure module's rule
// (`@/lib/projects/brief`); the network call lives in the feature module
// (`@/lib/projects/brief-client`), not in this body (`.claude/rules/frontend.md`).
//
// The markdown is rendered as SOURCE TEXT, deliberately: rendering model output
// as HTML would be an injection surface, and the repo already renders an
// imported markdown body this way (the on-demand note view) rather than
// pretending it is rendered prose. It is a React text node, so it is escaped.
//
// Regeneration is an explicit action with all three async states: the button
// disables while pending, a failure is shown in place, and the previous brief
// stays on screen so a failed refresh never blanks the section.

import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BRIEF_FALLBACK_LABEL, type ProjectBrief } from "@/lib/projects/brief";
import { requestProjectBrief } from "@/lib/projects/brief-client";

export function BriefSection({
  projectId,
  initialBrief,
}: {
  projectId: string;
  /** Assembled on the server so the first paint is complete, not a spinner. */
  initialBrief: ProjectBrief;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const synthesized = brief.state === "synthesized";

  async function regenerate() {
    setPending(true);
    setError(null);
    try {
      setBrief(await requestProjectBrief(projectId, { method: "POST" }));
    } catch {
      setError(
        "Could not regenerate the brief just now. The brief shown is the last one that loaded.",
      );
    } finally {
      setPending(false);
    }
  }

  const { summary } = brief;

  return (
    <section
      className="mt-6 rounded-lg border border-border bg-card p-4"
      data-project-brief
      data-brief-state={brief.state}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Brief
        </h2>
        {synthesized ? (
          <Badge variant="default">Synthesized</Badge>
        ) : (
          <Badge variant="secondary">{BRIEF_FALLBACK_LABEL}</Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {synthesized ? `by ${brief.model ?? "the configured model"}` : brief.promptVersion}
          {brief.generatedAt ? ` · ${brief.generatedAt}` : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={pending}
          aria-busy={pending}
          data-brief-regenerate
          onClick={regenerate}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5${pending ? " animate-spin" : ""}`} />
          {pending ? "Regenerating…" : "Regenerate"}
        </Button>
      </div>

      {/* A React text node — model output is never injected as markup. */}
      <div
        className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
        data-brief-body
      >
        {brief.markdown}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground" data-brief-summary>
        {summary.notesTotal} linked {summary.notesTotal === 1 ? "note" : "notes"}
        {summary.notesHiddenDeleted > 0 ? ` (${summary.notesHiddenDeleted} deleted)` : ""}
        {summary.subProjectsTotal > 0
          ? ` · ${summary.subProjectsTotal} ${summary.subProjectsTotal === 1 ? "sub-project" : "sub-projects"}`
          : ""}
        {summary.themes.length > 0 ? ` · themes: ${summary.themes.join(", ")}` : ""}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-brief-error
        >
          {error}
        </p>
      )}
    </section>
  );
}
