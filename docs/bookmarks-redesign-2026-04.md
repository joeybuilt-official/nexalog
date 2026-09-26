<!-- SPDX-License-Identifier: MIT -->

# Bookmarks redesign — Apr 2026

Operator complaints (paraphrased from screenshot review of `nexalog.com/app/bookmarks`):

1. Cards are too wide for the meta they hold (2-col everywhere wastes vertical real estate).
2. Layout is "hideous" — flat orange `Theme:` line, no hierarchy, dates buried, no thumbnails, all-caps `OTHER / VIDEO / SOCIAL` pill is shouty and content-poor.
3. Scroll within scroll — the result grid mounts its own `overflow-y-auto` viewport inside the page's main scroll. Page chrome should be sticky, the list should ride the document scroll.

4011 items currently filtered. Virtualization is non-negotiable past ~500.

## Panel

### UX / IA
Forest-tree categories sidebar is the right primary cut for this corpus — themes are how the user thinks. Dominant task is **find** (search + filter), secondarily **triage** (open / archive). Empty/loading/error already polished in commit `565a1d9`. Small fix: items count belongs in the filters bar, right-aligned, not below.

### Visual
Walnut palette is fine — the actual sin is `text-copper` / `bg-copper` used directly for an information label (the `Theme:` line in `CaptureCard`). Copper is the brand accent, not a meta token. Switch to `text-muted-foreground` for meta lines. Replace the all-caps kind pill with a small lucide icon next to the host. Type scale: title `text-sm` (Compact) / `text-sm font-medium` (Standard) / `text-base font-medium` (Rich). One semantic accent only — the existing `--ring` (copper) — kept on hover/focus.

### Motion / interaction
Hover surfaces an action toolbar (Open, Reader, Archive, Copy URL). Keyboard: `j`/`k` row nav, `o` open, `r` reader, `Backspace` archive (via `confirm-button.tsx`), `c` copy URL. Multi-select groundwork (set-of-selected-ids) lands; bulk-action toolbar follows up.

### Performance
`@tanstack/react-virtual@3.13.24` already a dep — use `useWindowVirtualizer`. That kills the inner scroll viewport and rides the document scroll. 4k rows × ~88px each ≈ 350k px tall page; virtualizer keeps the painted DOM bounded. No new deps.

### Accessibility
`<article>` per card with `<h3>` title + visible link. Focus order: title → host link → action buttons. All hover-only affordances mirrored in focus-visible. Contrast verified against walnut dark + light tokens.

### Information density
Three modes, persisted to `localStorage["nexalog:bookmarks:density"]`:

- **Compact** — 1-line row: favicon · title · host · age · actions. Fixed 56px row height.
- **Standard** (default) — favicon + title + 1-line theme + age + Open/Reader. 3 cols on `lg`, 4 on `2xl`, 2 on `md`, 1 on `sm`. ~140px estimated.
- **Rich** — og image hero + favicon + title + snippet + age + actions. 2 cols on `lg`, 3 on `2xl`. ~320px estimated.

Default = Standard. If item count > 1000 and no preference saved, suggest Compact (one-time hint, deferred).

## Decision log

- Window-virtualization (single document scroll) over inner-scroll virtualization. Trade-off: filter-bar must use `position: sticky` to stay pinned; achieved without changing AppShell.
- Density rendering lives in a bookmark-specific `BookmarkResultGrid`, passed to `ContentFinder` as `renderItem`. ContentFinder stays generic; bookmarks owns its own card grammar.
- Orange `text-copper` / `bg-copper` removed from `CaptureCard`. Replaced with `text-muted-foreground` (meta) and `bg-muted-foreground/40` (bullet dots). Copper still owns brand and focus-ring; not used as a content label.
- Kind pill replaced with a single lucide icon (Video, MessageSquare, FileText, Globe, Home, Library) sized 12-14px in `text-muted-foreground`.
- Bulk-action toolbar deferred — set-of-selected-ids state lands in the renderer; no UI surface yet.
- Filters consolidation (segmented + popover) deferred to keep ContentFinder generic. Items count moved into headline. Density toggle added next to Sort.
