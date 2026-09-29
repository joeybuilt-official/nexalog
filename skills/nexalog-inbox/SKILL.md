---
name: nexalog-inbox
description: Use when processing Nexalog inbox captures (brain/inbox/*.md) into typed brain pages.
version: 1.0
author: dustin-olenslager
license: MIT
tags: [nexalog, gbrain, inbox, worker, capture]
related_skills: [nexalog, gbrain, hermes-agent]
---

# Nexalog inbox worker — process captures into the brain

## When to Use

Run on a schedule (cron, ~every 10m) or on demand, to drain the Nexalog capture
inbox. Nexalog (the PWA/web app) only *writes* captures; **this skill is the
intelligence** — it transcribes, clips, extracts entities, writes typed pages,
and marks each capture processed. Nexalog itself makes zero LLM calls.

## ⚠ CRITICAL: you run in the Hermes sandbox (no /srv access)

The Hermes agent runs in a sandbox that mounts ONLY `hermes/data → /opt/data`.
The brain repo is **NOT visible locally** — every read/write against it goes
through `ssh brain-host` (SSH config alias, root@192.0.2.10). Examples:

```bash
# read captures (unprocessed)
ssh brain-host "grep -l 'status: \"inbox\"' /srv/brain/pages/inbox/*.md"
# read one file
ssh brain-host 'cat /srv/brain/pages/inbox/<ulid>.md'
# edit (sed/python over ssh) — prefer a heredoc'd python script piped over ssh
# commit
ssh brain-host 'cd /srv/brain/pages && git add inbox/ && git commit -m "..."'
# sync
ssh brain-host 'docker exec gbrain gbrain sync --repo /brain/pages --no-pull'
```

Never assume a bare local path works; always prefix brain-repo access with
`ssh brain-host`. The preflight gate (`scripts/nexalog-inbox-gate.sh` in the repo)
runs ON prod-host (`ssh brain-host bash /path/gate.sh`), not locally.

## Topology (verified live)

- **Brain repo (system of record):** `/srv/brain/pages` on prod-host
  (git root: `.git` + `gbrain.yml` + typed dirs). Bind-mounted into the gbrain
  container as `/brain`.
- **Inbox:** `inbox/<ulid>.md` — written by Nexalog `POST /api/capture`.
- **Typed dirs (write targets):** `people/`, `companies/`, `concepts/`,
  `projects/` (all `db_tracked` in `gbrain.yml`), plus `atoms/YYYY-MM-DD/` for
  extracted atomic insights, and `notes/` for free-standing notes.
- **gbrain CLI (inside the `gbrain` container):** `gbrain sync --repo /brain/pages`
  (git-to-brain incremental sync — the source is bound to `/brain/pages` inside the
  container, since `/srv/brain` is mounted as `/brain`; using
  `--repo /brain` fails with "Sync path does not match this source binding"),
  `gbrain embed --stale`, `gbrain list`, `gbrain search`.
  Managed sync requires `--no-pull` (git pull/rebase needs an explicit drained
  maintenance window).
- **git identity** in the brain repo is set: `Nexalog <nexalog@example.com>`.
- **GBrain MCP** (from Hermes): `https://gbrain.example.com/mcp`, bearer
  `MCP_GBRAIN_API_KEY`. Tools: `search`, `query`, `get_page`, `put_page`,
  `list_pages`, `add_link`, `add_timeline_entry`, `remember`, `entity`, `think`.

## Capture frontmatter contract

```yaml
---
type: note
nexalog:
  schema: 1
  status: "inbox"          # inbox → processing → processed | review | rejected
  kind: "note"             # note | link | file | audio | image | doc
  source: "pwa-share"      # pwa-share | web | bookmarklet | mcp | telegram
  captured_at: "2026-09-24T05:54:20.487Z"
  claimed_by: null
  claimed_at: null
  attachments: []          # relative paths under attachments/
  attachment_kinds: []     # per-attachment kind, index-aligned with `attachments`
  origin_url: null
  proposal: null
title: "..."
---
```

**`kind` is what tells you how to process the capture** (it is derived from the
attachment's MIME type/extension, not guessed). `attachment_kinds` carries the
per-file kind for a MIXED capture, where the capture-level `kind` can only name
one of them — read it before assuming every attachment matches the capture kind;
a capture holding a voice memo and a photo is `kind: "audio"` with
`attachment_kinds: ["audio", "image"]`. Audio attachments are always stored as
**opus** (D4), so they land as `…​.opus` whatever they were uploaded as.

## Procedure (one pass)

1. **Find work.** `ls /srv/brain/pages/inbox/*.md` and select
   captures whose frontmatter has `nexalog.status: "inbox"`. Skip anything else —
   never reprocess a `processed` or `review` capture.

2. **Claim it.** Set `nexalog.claimed_by` (worker id) + `claimed_at` (UTC now) so
   a concurrent run cannot double-process (the capture is the unit of work).

3. **Process by kind** (`kind` comes from the capture; for a mixed capture check
   `attachment_kinds` per file before assuming):
   - `note`: the body is the content. Extract entities
     (people/companies/concepts/projects) via the gbrain `extract` CLI or MCP
     `remember`; write/merge a page per entity into the matching typed dir.
     Title it from the content. Any durable, single-idea insight also lands as an
     `atoms/<YYYY-MM-DD>/<slug>.md` page (see atoms format below).
   - `link`: fetch the `origin_url` (or the body URL) and extract the readable
     text (trafilatura / readability via the fetch tool), then summarize into a
     `notes/<slug>.md` page with `source_url` frontmatter; extract entities as
     above. Keep the summary SHORT (the page is a pointer, not a mirror).
   - `audio`: transcribe the attachment (always stored as `.opus`), then treat
     the transcript as a `note`.
   - `image`: describe/OCR the attachment via the vision path, then treat it as
     a `note`.
   - `doc`: extract the text (pdf/docx/txt/…), then treat it as a `note`.
   - `file`: unrecognised binary — record it as an attachment, no extraction.

4. **Write pages.** One file per entity/note. Frontmatter must include:
   `type` (person|company|concept|project|note|atom), `title`, `slug` implied by
   path, `tags`, `updated_at`, `date`, and `nexalog.source_capture: <ulid>` for
   provenance. **Never overwrite human-edited content**: if a page exists, MERGE
   (append new facts under the existing body, update `updated_at`); do not clobber
   manual edits.

   **`date` is the one key that makes a page findable by time — it is not optional.**
   The brain's date extractor reads a page's TOP-LEVEL `event_date` / `date` / `published`
   only (plus a leading `YYYY-MM-DD-` filename, and only for `daily/` + `meetings/`
   slugs — an `atoms/YYYY-MM-DD/…` path is NOT read). Every other key, including
   `updated_at` and anything nested under `nexalog:`, is invisible to it: the page is
   then indexed with its IMPORT time, and a date-scoped recall can never return it.
   Set `date:` to the CONTENT's own date — the event, or the capture's `captured_at`
   for a note — never the time you ran.

5. **Mark the capture.** Update the inbox file's frontmatter:
   `status: "processed"`, `processed_at: <UTC now>`, and a `proposal` block
   describing what was written (pages + links), so the review UI can show it:
   ```yaml
   proposal:
     pages: ["people/jane-doe", "concepts/foo"]
     links: [["people/jane-doe", "companies/acme"]]
     summary: "Extracted 1 person, 1 concept"
   ```
   If uncertain (low confidence, ambiguous entity), use `status: "review"` instead.

6. **Commit + sync.** In the brain repo:
   `git add -A inbox/ people/ companies/ concepts/ projects/ atoms/ notes/`
   then `git commit -m "inbox: process <ulid> (<n> pages)"`. Then:
   `docker exec gbrain gbrain sync --repo /brain/pages --no-pull` (note: `--repo`
   is `/brain/pages`, NOT `/brain`) and
   `docker exec gbrain gbrain embed --stale` (embeddings — vectorization lives in
   GBrain, not Nexalog).

7. **Report.** Print one line per capture processed: ulid → status → pages
   written → commit sha. On any failure, leave the capture in `inbox` status and
   surface the error (do NOT mark processed).

## Atoms format (durable insights)

```yaml
---
type: atom
title: "The healthcheck that took down the service"
tags: [ops, docker]
date: 2026-09-23
source: nexalog/01M38...
---
<one idea, 1-3 short paragraphs, self-contained>
```

## Guardrails

- **Single writer.** The brain repo has a single-writer discipline (Nexalog holds
  a lockfile for its own commits). Do not run two inbox workers concurrently.
- **Never delete** inbox captures in this pass — processing marks, it does not
  remove. Cleanup/pruning is a separate, operator-gated concern.
- **No secrets in commits.** Never paste tokens/keys into page content.
- **Idempotent**: re-running a pass with no unprocessed captures must be a no-op
  (no commits, no syncs).
- **Human edits win** — merge, never clobber.
