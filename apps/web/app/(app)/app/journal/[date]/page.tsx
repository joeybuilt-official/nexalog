// SPDX-License-Identifier: MIT
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq } from "drizzle-orm";
import { JournalEntryEditor } from "./journal-entry-editor";
import { userTodayStr } from "@/lib/time/user-tz";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { date } = await params;
  if (!isoDate.test(date)) notFound();

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const [existing] = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, user.id),
        eq(schema.journalEntries.workspaceId, workspace.id),
        eq(schema.journalEntries.entryDate, date),
      ),
    )
    .limit(1);

  const isToday = date === (await userTodayStr());
  const display = new Date(date + "T12:00:00Z");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/app/journal"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Journal
        </Link>
      </div>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold">
          {isToday ? "Today" : display.toLocaleDateString(undefined, { weekday: "long" })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {display.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </header>

      <JournalEntryEditor
        entryDate={date}
        workspaceId={workspace.id}
        initial={
          existing
            ? {
                body: existing.body,
                mood: existing.mood,
                energy: existing.energy,
                voiceSourceId: existing.voiceSourceId,
              }
            : null
        }
      />
    </div>
  );
}
