# Nexalog navigation audit — Apr 2026

Author: agent (information-architecture lens)
Status: proposal accompanying the v1 must-haves restructure

## 1. Current nav inventory

The sidebar (`components/app-sidebar.tsx`) groups items by data type with
loose theme separators:

| Group (current)   | Items                                                           |
|-------------------|-----------------------------------------------------------------|
| (top)             | Dashboard · Today · Queue · Inbox · Synthesis                   |
| (middle)          | Notes · Bookmarks · Watch · Reading · Reference · Graph         |
| (chat/import)     | Chat · History · Import                                         |
| (footer)          | Settings                                                        |

Routes that exist but are not in the sidebar: `share`, `sites`, `themes`,
`billing`. The first two are utility pages reached via deep links; the
last two are reached from settings + content navigation. None of them
need a nav slot.

## 2. Friction points

The current grouping prioritizes data type. That collides with the
Apr-27 vision update: every surface should answer at least one question
in the synthesis loop ("what's becoming a thing? what's ripe to fuse?
what's gone stale? what should I write next? what surprised the system?").
Specific issues:

1. **Today, Queue, Inbox, Synthesis sit side-by-side without a story.**
   Today is now the daily synthesis dashboard; Inbox is review of
   suggestion cards; Synthesis is the all-suggestions surface; Queue is
   the prioritized read-list. They are *all* about acting on system-
   driven signals — but they read as four equal siblings.
2. **Watch / Reading / Reference are content-type hoppers**, conceptually
   the same shape as Bookmarks but split out for v1. Without a parent
   "library" affordance the user has to remember which hopper a given
   item lives in.
3. **Chat sits in the third group with History and Import.** Chat is a
   first-class capture/synthesis surface (per-page chat + global), not
   an "extra".
4. **Graph and Synthesis are both in different groups** even though they
   are the two purest expressions of the system-driven loop.
5. **No journal slot.** v1 introduces journal as a first-class feature.
6. **Dashboard duplicates Today.** With the Today redesign Dashboard's
   role is unclear. We keep it for v1 only as the "billing/quota at a
   glance" surface (per existing implementation), but not as the first
   nav entry — it's a workspace-level concern.

## 3. IA panel review

Four lenses, in the spirit of the vision memo:

- **Information architecture (Morville/Rosenfeld):** group by user
  intent, not by content shape. Surfaces that share a verb belong
  together. Cap top-level groups at 4 (working-memory limit).
- **Cognitive science:** chunking lowers nav cost. The user should be
  able to predict where a feature lives from the verb in their head
  ("I want to *see* my graph", "I want to *write* something", "I want
  the system to *suggest* what's next").
- **Language:** group labels are nouns of a *moment*, not data shapes:
  Today (now), Library (what I have), Synthesis (what the system sees),
  Workspace (settings).
- **Human-thought:** match the synthesis-loop questions to nav slots
  one-to-one wherever possible. Today owns the daily questions;
  Synthesis/Inbox/Graph own the longer-horizon ones; Library owns the
  raw substrate.

## 4. Proposed structure

Four intent-based groups, in the order they map to a typical session
(daily check-in → produce → review system signal → tweak):

```
Today         — Today, Journal, Inbox, Queue
Library       — Notes, Bookmarks, Watch, Reading, Reference, Imported
Synthesis     — Graph, Suggestions (= /app/synthesis), Chat, Search
Workspace     — Dashboard, Settings
```

Notes on the groupings:

- **Today** = "now". It is the only place the user *needs* to land each
  morning. Today (synthesis dashboard), Journal (write the day),
  Inbox (review the suggestion cards the system queued), Queue (act on
  the prioritized read-list).
- **Library** = "what I have". All the content-type surfaces sit here.
  Bookmarks remains the catch-all; Watch / Reading / Reference are the
  v1 hoppers; Imported holds parsed conversations and files. The route
  `Imported` maps to the existing `/app/import` URL — we rename only
  the label.
- **Synthesis** = "what the system sees". Graph and Suggestions are the
  two pure-synthesis surfaces; Chat lives here because it is the
  conversational synthesis surface (per-page chat + global). Search is
  the "find anything across surfaces" affordance — already wired to the
  command-K modal, but explicit in nav for first-time discovery.
- **Workspace** = settings + at-a-glance. Dashboard remains for billing
  and quota signals; Settings is everything else.

History (the old `/app/history` route, renamed from "Plexo History" in
commit `f9acb98`) is *not* in the new sidebar — it's a debug/admin
surface and the user reaches it from Settings → History when needed.
The route stays so existing links don't break.

Import/Imported keeps its `/app/import` URL — only the label changes
to "Imported", which reads better as a noun in the Library group.

## 5. Routes — preserved

All existing route URLs are preserved. Only sidebar grouping and labels
change. Any user-saved bookmark for `/app/dashboard`, `/app/queue`,
`/app/import`, etc. continues to work.

## 6. Mobile

The sidebar already has a close-button for mobile (commit `565a1d9`).
The new structure adds one more group (4 vs 4 groups before, but the
old layout had 4 separators, not labels). Group headers are tiny
all-caps labels; they don't add overflow risk on small screens. The
mobile sheet keeps the same `onClose` behavior.

## 7. Out of scope

- Renaming routes (one-way door — defer to a v1.1 audit).
- A search "page" (search lives in the modal; only the nav entry is
  new — clicking it triggers the same Cmd-K).
- Reorganizing the Settings sub-pages.
