// SPDX-License-Identifier: MIT
/**
 * /app/brain — the brain's pages, browsable and readable.
 *
 * Two states, one route, because they are one surface:
 *   /app/brain                      → the index (every page, typed filter)
 *   /app/brain/concepts/litellm-gateway → the reader for that page
 *
 * The catch-all segment (`[[...slug]]`) is REQUIRED, not stylistic: a brain
 * slug is a path, so `/app/brain/concepts/litellm-gateway` has to reach a page
 * through two segments — a single `[slug]` could never address one. The
 * optional form (`[[...slug]]`, not `[...slug]`) is what makes the same file
 * serve the index too.
 *
 * This is the route the search results and the Garden nodes now point at —
 * before it existed, every brain hit the app could FIND was a 404 on click.
 *
 * Auth is the `(app)` layout's (a session, or a redirect to /login); the reads
 * go through the same `lib/pages` path the API routes use, so the reader and
 * the API can never disagree about what a page says.
 */

import { notFound } from "next/navigation";
import Link from "next/link";

import { BrainPageList } from "@/components/brain/brain-page-list";
import { BrainPageReader } from "@/components/brain/brain-page-reader";
import { readPage } from "@/lib/pages/read";

export const dynamic = "force-dynamic";

export default async function BrainPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const joined = (slug ?? []).join("/");

  if (!joined) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Brain</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every page in the brain — people, companies, projects, concepts and atoms —
            read straight from the brain repo through GBrain.
          </p>
        </header>
        <BrainPageList />
      </div>
    );
  }

  const payload = await readPage(joined);
  // A slug that resolves to nothing is a 404. Never a blank page — an empty
  // reader would look like a page that exists and happens to be empty.
  if (!payload) notFound();

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/app/brain" className="underline hover:text-foreground">
          Brain
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{joined}</span>
      </nav>
      <BrainPageReader payload={payload} />
    </div>
  );
}
