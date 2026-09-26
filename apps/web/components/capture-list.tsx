// Shared list for Phase 11 hopper surfaces (/app/watch, /app/reading, /app/reference, /app/sites).

import Link from "next/link";
import { displayTitle } from "@/lib/captures/display";

export interface CaptureRow {
  id: string;
  url: string | null;
  ogTitle: string | null;
  urlHost: string | null;
  createdAt: Date;
  stalenessScore: number;
  evergreen: boolean | null;
}

export function CaptureList({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: CaptureRow[];
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <div className="mt-6 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          rows.map((row) => {
            const cardBody = (
              <>
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">
                  {displayTitle(row)}
                </span>
                {row.evergreen ? (
                  <span className="ml-auto text-[10px] text-emerald-500 border border-emerald-500/40 rounded px-1.5 py-0.5">
                    evergreen
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {row.url}
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{new Date(row.createdAt).toLocaleDateString()}</span>
                {row.stalenessScore > 0 ? (
                  <span>staleness {row.stalenessScore.toFixed(2)}</span>
                ) : null}
              </div>
              </>
            );
            const cardClass = "block rounded-lg border border-border p-4 transition-colors";
            return row.url ? (
              <a
                key={row.id}
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className={`${cardClass} hover:bg-muted/50`}
              >
                {cardBody}
              </a>
            ) : (
              <div key={row.id} className={cardClass}>
                {cardBody}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-8">
        <Link href="/app/inbox" className="text-xs text-muted-foreground hover:text-foreground">
          back to inbox
        </Link>
      </div>
    </div>
  );
}
