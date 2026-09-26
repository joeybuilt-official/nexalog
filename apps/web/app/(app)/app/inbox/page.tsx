import { getAuthUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { eq, and, desc, isNull, count, sql } from "drizzle-orm";
import { getUserWorkspaces } from "@/lib/workspace";
import { noteDisplayTitle } from "@/lib/captures/display";
import Link from "next/link";
import { InboxVoice } from "./inbox-voice";
import { InboxSuggestionChip, type PendingSuggestion } from "./inbox-suggestion-chip";

const LIFECYCLE_STATES = ["raw", "understanding", "refined", "active", "archived"];
const NOTE_KINDS = ["note", "daily"];
const INBOX_LIMIT = 200;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ lifecycle?: string; kind?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const { lifecycle, kind } = await searchParams;

  const activeLifecycle = LIFECYCLE_STATES.includes(lifecycle ?? "") ? lifecycle! : "raw";
  const activeKind = NOTE_KINDS.includes(kind ?? "") ? kind! : undefined;

  const excludeBookmarkTwins = sql`NOT EXISTS (SELECT 1 FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} AND cs.kind = 'url')`;

  const conditions = [
    eq(schema.notes.workspaceId, workspace.id),
    eq(schema.notes.lifecycleState, activeLifecycle),
    isNull(schema.notes.deletedAt),
    excludeBookmarkTwins,
  ];
  if (activeKind) conditions.push(eq(schema.notes.kind, activeKind));

  const rows = await db
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      content: sql<string | null>`left(${schema.notes.content}, 400)`,
      lifecycleState: schema.notes.lifecycleState,
      createdAt: schema.notes.createdAt,
      captureId: sql<string | null>`(SELECT cs.id FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} LIMIT 1)`,
      pendingSuggestion: sql<PendingSuggestion | null>`(SELECT cs.metadata->>'pendingSuggestion' FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} LIMIT 1)`,
    })
    .from(schema.notes)
    .where(and(...conditions))
    .orderBy(desc(schema.notes.createdAt))
    .limit(INBOX_LIMIT + 1);
  const capped = rows.length > INBOX_LIMIT;
  const notes = capped ? rows.slice(0, INBOX_LIMIT) : rows;

  const countRows = await db
    .select({ lifecycleState: schema.notes.lifecycleState, c: count() })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, workspace.id),
        isNull(schema.notes.deletedAt),
        excludeBookmarkTwins
      )
    )
    .groupBy(schema.notes.lifecycleState);

  const counts: Record<string, number> = {};
  for (const r of countRows) {
    counts[r.lifecycleState] = Number(r.c);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Inbox</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Captures and notes by lifecycle state
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Worker-processed captures — with the pages Hermes wrote and anything it
        flagged for review — live in the{" "}
        <Link href="/inbox" className="text-primary underline underline-offset-2">
          capture inbox
        </Link>
        .
      </p>
      <InboxVoice workspaceId={workspace.id} />

      {/* Lifecycle filter tabs */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {LIFECYCLE_STATES.map((state) => {
          const active = state === activeLifecycle;
          const params = new URLSearchParams({ lifecycle: state });
          if (activeKind) params.set("kind", activeKind);
          return (
            <Link
              key={state}
              href={`/app/inbox?${params.toString()}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              {state} {counts[state] ? `(${counts[state]})` : "(0)"}
            </Link>
          );
        })}
      </div>

      {/* Kind filter */}
      <div className="mt-2 flex gap-2">
        {["all", ...NOTE_KINDS].map((k) => {
          const active = k === "all" ? !activeKind : k === activeKind;
          const params = new URLSearchParams({ lifecycle: activeLifecycle });
          if (k !== "all") params.set("kind", k);
          return (
            <Link
              key={k}
              href={`/app/inbox?${params.toString()}`}
              className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                active
                  ? "bg-accent text-accent-foreground border-transparent"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {k}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 space-y-2">
        {notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Nothing in <span className="lowercase">{activeLifecycle}</span>
              {activeKind ? ` · ${activeKind}` : ""}.
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {activeLifecycle === "raw"
                ? "New captures land here. Save a link from the Telegram bot, the Voice memo button above, or via Plexo."
                : activeLifecycle === "understanding"
                  ? "Items being processed. They move to refined automatically."
                  : activeLifecycle === "refined"
                    ? "Processed captures sit here until you act on them."
                    : activeLifecycle === "active"
                      ? "Captures you've opened or are actively engaging with."
                      : "Older items archived from view."}
            </p>
            {activeLifecycle === "raw" && (
              <Link
                href="/app/today"
                className="mt-4 inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
              >
                Capture something
              </Link>
            )}
          </div>
        ) : (
          notes.map((note) => {
            const suggestion = note.pendingSuggestion
              ? (typeof note.pendingSuggestion === "string"
                  ? (() => { try { return JSON.parse(note.pendingSuggestion as unknown as string) as PendingSuggestion; } catch { return null; } })()
                  : note.pendingSuggestion)
              : null;
            return (
              <div key={note.id} className="rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors">
                <Link href={`/app/notes/${note.id}`} className="block">
                  <div className="flex items-start gap-2">
                    <span
                      className="min-w-0 flex-1 break-words font-medium leading-snug line-clamp-2"
                      title={noteDisplayTitle(note.title, note.content)}
                    >
                      {noteDisplayTitle(note.title, note.content)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      {note.lifecycleState}
                    </span>
                  </div>
                  {note.content && (
                    <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {note.content.replace(/<[^>]+>/g, " ").trim()}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">
                    {new Date(note.createdAt).toLocaleString()}
                  </div>
                </Link>
                {suggestion && note.captureId ? (
                  <InboxSuggestionChip captureId={note.captureId} suggestion={suggestion} />
                ) : null}
              </div>
            );
          })
        )}
        {capped && (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            Showing the {INBOX_LIMIT} most recent. Process or filter to see more.
          </p>
        )}
      </div>
    </div>
  );
}
