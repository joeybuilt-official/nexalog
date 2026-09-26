// SPDX-License-Identifier: MIT
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, desc, eq } from "drizzle-orm";
import { userTodayStr } from "@/lib/time/user-tz";

function moodLabel(n: number | null): string {
  if (n == null) return "—";
  return ["", "low", "meh", "ok", "good", "high"][n] ?? String(n);
}

export default async function JournalIndexPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const today = await userTodayStr();

  const [todayRow, recent] = await Promise.all([
    db
      .select()
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.userId, user.id),
          eq(schema.journalEntries.workspaceId, workspace.id),
          eq(schema.journalEntries.entryDate, today),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.userId, user.id),
          eq(schema.journalEntries.workspaceId, workspace.id),
        ),
      )
      .orderBy(desc(schema.journalEntries.entryDate))
      .limit(60),
  ]);

  const recentNotToday = recent.filter((r) => r.entryDate !== today);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Journal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One entry per day. Mood, energy, the day in your own words.
          </p>
        </div>
        <Link
          href={`/app/journal/${today}`}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          {todayRow ? "Open today" : "Start today"}
        </Link>
      </div>

      <section className="mb-8 rounded-lg border border-border bg-card/50 p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Today</h2>
          <span className="text-xs text-muted-foreground">{today}</span>
        </header>
        {todayRow ? (
          <Link href={`/app/journal/${today}`} className="block">
            <p className="line-clamp-3 text-sm text-foreground/90">
              {todayRow.body.trim() || "Empty entry — open to write."}
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span>mood: {moodLabel(todayRow.mood)}</span>
              <span>energy: {moodLabel(todayRow.energy)}</span>
            </div>
          </Link>
        ) : (
          <Link
            href={`/app/journal/${today}`}
            className="block rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            No entry yet. Start writing today&rsquo;s.
          </Link>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Recent</h2>
        {recentNotToday.length === 0 ? (
          <div className="rounded-md border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            Nothing in the journal yet. Days you write will land here.
          </div>
        ) : (
          <ul className="space-y-2">
            {recentNotToday.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/app/journal/${row.entryDate}`}
                  className="block rounded-md border border-border bg-card/30 p-3 hover:bg-muted/40"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">{row.entryDate}</span>
                    <span className="text-[11px] text-muted-foreground">
                      mood: {moodLabel(row.mood)} · energy: {moodLabel(row.energy)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {row.body.trim() || "Empty entry."}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
