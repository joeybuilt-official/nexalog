// Native-client surface for the Today dashboard (web parity §7).
// Returns the same TodayCardsData the server-rendered Today page composes.
// Synthesis lanes were cut 2026-06-27 — deterministic lanes only.

import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { loadTodayCards } from "@/lib/today/cards-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  const requested = new URL(request.url).searchParams.get("workspaceId");
  const ws = requested
    ? (workspaces.find((w) => w.id === requested) ?? workspaces[0])
    : workspaces[0];
  if (!ws) {
    return Response.json({
      continueItems: [],
      recentSaves: [],
      triageCount: 0,
      goneStale: [],
    });
  }

  const cards = await loadTodayCards({ workspaceId: ws.id });
  return Response.json(cards);
}
