// SPDX-License-Identifier: MIT
/**
 * /app/graph — the Knowledge Garden.
 *
 * The brain's link graph, rendered. GBrain owns the graph and its embeddings;
 * Nexalog draws it. Optional `?slug=` focuses one page's neighbourhood.
 *
 * The page never fails on a missing brain: `getComposition()` throws when
 * BRAIN_REPO is unset, so the wiring is read defensively and the garden then
 * falls back to whatever `/api/graph` can read locally (see the route's
 * degradation ladder).
 */
import { getAuthUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { getComposition } from "@/composition";
import { GraphCanvas } from "./graph-canvas";

export const dynamic = "force-dynamic";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { slug } = await searchParams;

  let gbrainConfigured = false;
  try {
    gbrainConfigured = getComposition().gbrain !== null;
  } catch {
    // BRAIN_REPO unset — standalone mode. The canvas reports the details.
    gbrainConfigured = false;
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Garden</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The brain&apos;s living web of people, companies, projects and concepts.
          {!gbrainConfigured &&
            " GBrain is not configured in this environment, so the garden is drawn from the brain repo's own links where it can."}
        </p>
      </header>
      <GraphCanvas rootSlug={slug ?? null} />
    </div>
  );
}
