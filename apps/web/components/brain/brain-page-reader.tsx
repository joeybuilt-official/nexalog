// SPDX-License-Identifier: MIT
"use client";

/**
 * BrainPageReader — one brain page: title, type, body, and the typed links
 * in/out that make the brain a graph rather than a folder.
 *
 * The body renders through `MarkdownBody` (the repo's dependency-free markdown
 * renderer, shared with the Journal), with `[[wiki links]]` rewritten to real
 * in-app anchors using the page's own link list as the resolution set.
 *
 * "Ask about this page" opens the chat rail (`BrainAskControl` → `ChatRail`),
 * which asks the server whether this deployment can take a turn and states the
 * answer — a rail that cannot answer says so instead of showing a composer.
 */

import Link from "next/link";

import { MarkdownBody } from "@/components/markdown-body";
import { BrainAskControl } from "@/components/brain/brain-ask-control";
import { brainPageHref } from "@/lib/search/result-href";
import type { BrainPagePayload } from "@/lib/pages/degrade";

function LinkColumn({
  title,
  links,
  empty,
}: {
  title: string;
  links: BrainPagePayload["links"];
  empty: string;
}) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {links.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {links.map((l, i) => (
            <li key={`${l.slug}:${l.linkType}:${i}`} className="text-sm">
              <Link
                href={brainPageHref(l.slug)}
                className="text-foreground underline decoration-border underline-offset-2 hover:decoration-copper"
              >
                {l.title || l.slug}
              </Link>
              {l.linkType ? (
                <span className="ml-2 text-[11px] italic text-muted-foreground">
                  {l.linkType}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BrainPageReader({ payload }: { payload: BrainPagePayload }) {
  const { page, links, backlinks } = payload;

  // Resolution set for `[[wiki links]]` in the body: the page's own typed
  // links first (they carry titles), plus the page itself.
  const targets = [
    { slug: page.slug, title: page.title },
    ...links.map((l) => ({ slug: l.slug, title: l.title })),
    ...backlinks.map((l) => ({ slug: l.slug, title: l.title })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {page.type || "page"}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">{page.slug}</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">{page.title || page.slug}</h1>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div>
            {/* Was a disabled button that said chat "is not built yet". It is
                now real: the rail opens and states, from the server, whether
                this deployment can take a turn. */}
            <BrainAskControl scope={page.slug} scopeTitle={page.title || page.slug} />
          </div>
          <Link
            href={`/app/graph?slug=${encodeURIComponent(page.slug)}`}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Show in Garden
          </Link>
        </div>
      </header>

      {payload.degraded && (
        <div className="rounded-lg border border-primary/50 bg-surface p-4 text-sm">
          <p className="font-medium text-foreground">Read from the brain repo, not GBrain</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {payload.note ?? "This page was rebuilt from local sources."}
          </p>
        </div>
      )}

      {page.body.trim() ? (
        <article className="rounded-lg border border-border bg-card p-4">
          <MarkdownBody text={page.body} targets={targets} />
        </article>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          This page has no body text yet.
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <LinkColumn
          title={`Links out (${links.length})`}
          links={links}
          empty="This page does not link to anything yet."
        />
        <LinkColumn
          title={`Linked from (${backlinks.length})`}
          links={backlinks}
          empty="Nothing links to this page yet."
        />
      </div>
    </div>
  );
}
