# Nexalog — Gap Matrix & Analysis (Phase 2)

**Date:** 2026-06-13 · **HEAD:** `d4aac45` · Built from the competitive benchmark × the Phase 1 State Report.

**Legend** — State: ✅ present · 🟡 partial · ⛔ absent.
Ownership: `[N]` Nexalog-domain · `[P]` Plexo-via-Jex · `[X]` Jex-protocol-gap (prerequisite Jex work).
Weight: **TS** table-stakes (credibility blocker) · **DIFF** differentiator · **PO** Plexo-only opening (moat).

---

## 1. Gap matrix

### Capture & input
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Quick capture (hotkey→inbox) | ✅ | [N] | TS | Cmd+Shift+C modal; ext omnibox `nx`, Alt+Shift+S |
| Web clipper | ✅ | [N] | TS | MV3 ext v1.2.1, context-menu, auto-hopper |
| Native mobile capture | ⛔ | [N] | TS | WebView shell; share-intent **declared but dead** (no receiver plugin) |
| Voice/audio + transcription | 🟡→⛔ | [X] | TS | `/api/voice` uploads to R2, **never transcribes**; Deepgram-via-Jex unexposed |
| Daily notes / journal | 🟡 | [N] | DIFF | route+schema exist, **0 entries** in prod — dead habit surface |
| Highlight/source sync (Readwise) | ⛔ | [N] | DIFF | no integration |

### Structure & modeling
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Bidirectional links / backlinks | 🟡 | [N] | TS | `[[wikilink]]` + backlinks panel ship; `note_links` **0 rows** in prod |
| Block references / transclusion | ⛔ | [N] | DIFF | block UUIDs assigned, **no consumer**; opaque-text notes can't transclude |
| Typed objects / relations | ⛔ | [N] | DIFF | no typed-object table; notes/captures are opaque text |
| Databases / collections / sets | 🟡 | [N] | DIFF | `bookmark_collections` + `projects` exist; projects **0 rows** |
| Nested tags / properties | 🟡 | [N] | TS | flat `bookmark_tags` (25), nullable parentId unused; no per-object props |
| Outliner + WYSIWYG blocks | 🟡 | [N] | DIFF | WYSIWYG yes; **no outliner** (fold/zoom/indent-as-structure) |

### Visualization & navigation
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Graph view (global + local) | 🟡 | [P] | DIFF | strong d3 graph but it's a **themes-forest synthesis graph, not a note-link graph** |
| Edgeless canvas / whiteboard | ⛔ | [N] | DIFF | no tldraw/excalidraw |
| Board / calendar / table views | ⛔ | [N] | DIFF | content-finder is a result grid, not DB views |
| Spaced repetition | ⛔ | [P] | PO | not built (planned) |

### Retrieval
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Fast full-text search | 🟡 | [N] | TS | `capture_sources` real FTS; **`notes` has none** (JS substring) |
| Live queries / query language | ⛔ | [N] | DIFF | no saved/live queries |
| Semantic "ask your notes" | 🟡 | [P] | PO | 3-way RRF works **if vectors present**; chat grounding still FTS+recency (no embed recall) |
| Verifiable citations | ✅ | [P] | PO | chat source chips render (`chat-client.tsx:349`); not yet inline-attributed |

### AI-native (all `[P]` — Plexo owns intelligence)
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| In-context generation/summarization | 🟡 | [P] | DIFF | title-suggest, typo-correct, project brainstorm — clean Plexo |
| Agents / automations | ⛔ | [P] | PO | none autonomous |
| Salience / surfacing ("right note finds you") | ⛔ | [P]/[X] | **PO** | Today = `createdAt`/`updatedAt` ordering; ~10% real. **No Plexo salience verb.** The marquee opening. |

### Sync, storage, sovereignty
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Local-first storage | ⛔ | [N] | TS | pure server-of-record; no offline |
| E2E encryption / zero-knowledge | ⛔ | [N] | DIFF | none; **structurally fights Plexo needing plaintext** (conflict) |
| P2P / self-hosted sync | 🟡 | [P] | DIFF | MIT self-host gives CRUD; all intelligence no-ops w/o Plexo |
| Plain-file portability / **export** | ⛔ | [N] | **TS** | **no export endpoint at all — data jail.** One-way door to fix. |
| Desktop + native mobile sync | 🟡 | [N] | TS | one Postgres, connectivity-required; mobile not native |

### Extensibility & collaboration
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Plugin ecosystem / public API | 🟡 | [N] | DIFF | Jex tools (23 registered) inbound; no public user-facing plugin API |
| Templates | ⛔ | [N] | TS | none found |
| Real-time multiplayer | ⛔ | [N] | DIFF | no CRDT/presence |
| Publish to web | ⛔ | [N] | DIFF | none |

### UX (silent differentiator)
| Capability | State | Own | Wt | Evidence / note |
|---|---|---|---|---|
| Speed | 🟡 | [N] | TS | web snappy; full-doc HTML autosave + 4k-node SVG are risks |
| Modern, polished UI | ✅ | [N] | TS | shadcn, dark mode, honest states |
| Gentle learning curve | ✅ | [N] | TS | low — but see adoption inversion below |

---

## 2. Surfaced conflicts (escalate — do NOT resolve here)

1. **Path A vs Path B (the boundary fork).** Plexo `memory/embeddings` + `memory/cluster` 404, so Nexalog grew its own pgvector store + local k-means + RRF fusion. *Architect:* a deliberate, working architecture fork; deleting the dead 404 paths is the cleanup. *Synapse:* local k-means + vector ranking living in Nexalog is a **borderline-to-clear violation** of "Plexo owns ALL intelligence." → **Decision: do we build the `[X]` Plexo endpoints and migrate back to Path A, or bless Path B as Nexalog-owns-vector-storage (Plexo-owns-model)?** This is an ADR.

2. **Local-first / portability vs hosted-SaaS revenue.** *Keeper:* no export + no local-first is the deepest sovereignty deficit vs Anytype/Obsidian. *Business invariant:* hosted SaaS = revenue, self-host = free. Full local-first could erode the hosted moat. → escalate.

3. **E2E / zero-knowledge vs Plexo-needs-plaintext.** Intelligence requires server-readable content; zero-knowledge forecloses the entire moat. These are mutually exclusive as stated. → escalate (likely: accept no-E2E, compete on intelligence instead of privacy).

4. **Typed-objects power vs adoption risk — INVERTED.** Tana lost 41% in 6 weeks to supertag *complexity*. *Cartographer:* Nexalog's risk is the **opposite** — too *shallow*: 15 authored notes vs 3564 bookmark-twins = import-and-forget graveyard. → the fix is a reason-to-return (daily resurfacing/synthesis), not more structure. Adding Anytype-style typed objects could re-import Tana's complexity risk. Tension between Librarian (model structure) and Cartographer (don't out-complex yourself).

5. **Scope discipline (Cartographer vs Maintainability).** Cartographer: the authored-note loop + voice are *the product*, not polish; scoping them out keeps Nexalog mediocre. Maintainability: pipeline items are blast-radius + cost. → sequencing decision for Phase 3.

---

## 3. Pre-mortem — "expansion shipped, still lost to Obsidian/Anytype"

1. **Cause: still a bookmark graveyard.** We shipped features but never created a reason to *write* or *return*. Users dump links, never come back. → **Fallback:** make daily resurfacing/synthesis (PO salience) the *first* differentiator phase, not the last; measure authored-note count + 7-day return as the north-star gate, not feature count.
2. **Cause: parity work (canvas, DB views, outliner) ate quarters and we shipped a worse Notion/Obsidian.** Chasing incumbents on their turf is a losing race (AppFlowy's trap). → **Fallback:** cap parity at *credibility threshold* (links that actually populate, notes FTS, real mobile capture, export) and spend the rest on the moat no one else has.
3. **Cause: the moat never materialized because the `[X]` Plexo endpoints (salience, embeddings, cluster, node-merge, transcription) slipped — they're cross-repo and unowned.** → **Fallback:** every `[X]` becomes an explicit Plexo-repo prerequisite with its own gate; no Nexalog phase may *depend* on an unbuilt `[X]` without that prerequisite scheduled first.

## 4. Differentiation thesis (defended against the OSS first principles)

> **Every incumbent bolts AI onto a knowledge store; Nexalog makes the intelligence the store's backbone.** Obsidian/Logseq/Anytype/AppFlowy/SiYuan all converged on the same shape — an atomic unit (file/block/object) plus a *derived* or *modeled* link layer, with AI as an optional pane. None can make intelligence the substrate without becoming a different product, because their architectures put the *user's* structure first and bolt retrieval on top. Nexalog inverts it: capture is frictionless and *unstructured by the user*, and **Plexo supplies the structure** — salience ("the right note finds you"), cited "ask-your-notes," and agentic promotion of ripe ideas into sibling apps (Levio tasks, Pushd deploys) that no single-app PKM can offer. The defensible claim is **not** "better editor than Obsidian" or "more typed than Anytype" — Nexalog will lose both races. It is **"the only PKM where your knowledge works for you while you're away."**
>
> **The catch the OSS first principles enforce:** intelligence-as-backbone only matters *after* table-stakes credibility (links that populate, notes search, real mobile capture, an exit door). A magic moat behind a broken front door still loses. Sequence accordingly.

---

## 5. Sequencing implication (feeds Phase 3)

1. **Credibility tier (TS gaps, mostly `[N]`, reversible):** notes FTS; make `[[links]]`/backlinks actually populate; real mobile capture (fix the dead share intent); **data export** (one-way door → ADR); templates; Cmd-K actions.
2. **Differentiator tier (DIFF, `[N]`/`[P]`):** daily-notes habit surface; DB views over one dataset; note-link graph (distinct from synthesis graph); canvas later.
3. **Moat tier (PO, `[P]`/`[X]`):** salience/surfacing; full semantic chat grounding + inline citations; agentic promotion to Levio/Pushd; spaced resurfacing. Each `[X]` gated on its Plexo prerequisite.
