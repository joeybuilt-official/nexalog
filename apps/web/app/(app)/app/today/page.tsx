// SPDX-License-Identifier: MIT
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getUserWorkspaces } from "@/lib/workspace";
import { loadTodayCards } from "@/lib/today/cards-data";
import { CaptureBar } from "./capture-bar";
import { TodayCards } from "./today-cards";
import { JournalPromo } from "./journal-promo";
import { SmartViewList } from "@/components/smart-view-list";
import { TodayBrief } from "@/components/today-brief";
import { TodayForgotten } from "@/components/today-forgotten";
import { TodayRelated } from "@/components/today-related";
import { userTodayStr } from "@/lib/time/user-tz";
import { RotateCcw } from "lucide-react";

export default async function TodayPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const date = await userTodayStr();
  const display = new Date(date + "T12:00:00Z");

  const [journalRow, cardsData] = await Promise.all([
    db
      .select()
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.userId, user.id),
          eq(schema.journalEntries.workspaceId, workspace.id),
          eq(schema.journalEntries.entryDate, date),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    loadTodayCards({ workspaceId: workspace.id }),
  ]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {display.toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </header>

      <CaptureBar workspaceId={workspace.id} />

      <SmartViewList workspaceId={workspace.id} />

      <TodayBrief />

      <TodayForgotten />

      <TodayRelated />

      <Link
        href="/app/review"
        className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
      >
        <RotateCcw className="h-4 w-4 text-muted-foreground" />
        <span>Spaced Review</span>
        <span className="ml-auto text-xs text-muted-foreground">Review due items →</span>
      </Link>

      <JournalPromo
        workspaceId={workspace.id}
        date={date}
        initialBody={journalRow?.body ?? null}
      />

      <TodayCards
        workspaceId={workspace.id}
        continueItems={cardsData.continueItems}
        recentSaves={cardsData.recentSaves}
        triageCount={cardsData.triageCount}
        goneStale={cardsData.goneStale}
      />

      {/* P10: graph de-emphasised to a sidebar tile per ADR-0013 */}
      <div className="mt-6">
        <Link
          href="/app/graph"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <span>↗</span>
          <span>Themes graph</span>
        </Link>
      </div>
    </div>
  );
}
