import {
  pgSchema,
  uuid,
  text,
  timestamp,
  index,
  real,
  boolean,
  integer,
  jsonb,
  date,
  smallint,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";


export const nexalogSchema = pgSchema("nexalog");

export const workspaces = nexalogSchema.table(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull().default("personal"),
    color: text("color").notNull().default("#6366f1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workspaces_user_id_idx").on(table.userId),
  ]
);

export const notes = nexalogSchema.table(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    kind: text("kind").notNull().default("note"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    date: text("date"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // `fts` — generated STORED tsvector, weighted title (A) + content (B).
    // Defined in drizzle/0013_notes_fts.sql and referenced via raw `sql`
    // (ts_rank_cd / websearch_to_tsquery) in the search + chat routes, mirroring
    // capture_sources.fts (drizzle/0003). Not declared as a column object here
    // because Drizzle can't express GENERATED ALWAYS AS … STORED.
  },
  (table) => [
    index("notes_workspace_id_idx").on(table.workspaceId),
    index("notes_user_id_idx").on(table.userId),
  ]
);

// kindClassified values: 'video' | 'article' | 'reference' | 'social' | 'homepage' | 'other'
export const captureSources = nexalogSchema.table(
  "capture_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull().default(""),
    url: text("url"),
    state: text("state").notNull().default("raw"),
    noteId: uuid("note_id"),
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    ogImage: text("og_image"),
    faviconUrl: text("favicon_url"),
    audioUrl: text("audio_url"),
    // Phase 11 — capture lifecycle (classification, staleness, hopper bookkeeping).
    kindClassified: text("kind_classified"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    httpStatus: integer("http_status"),
    stalenessScore: real("staleness_score").notNull().default(0),
    stalenessReason: text("staleness_reason"),
    smartArchivedAt: timestamp("smart_archived_at", { withTimezone: true }),
    urlHost: text("url_host"),
    urlPath: text("url_path"),
    ogType: text("og_type"),
    lastVisitedAt: timestamp("last_visited_at", { withTimezone: true }),
    stalenessReasons: jsonb("staleness_reasons").$type<string[]>().default([]),
    evergreen: boolean("evergreen"),
    currentCheckedAt: timestamp("current_checked_at", { withTimezone: true }),
    // Phase 11 pass 2 — reader mode + theme cache + queue.
    extractedText: text("extracted_text"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    summary: text("summary"),
    paywalled: boolean("paywalled"),
    readMinutes: integer("read_minutes"),
    watchMinutes: integer("watch_minutes"),
    themeId: text("theme_id"),
    themeLabel: text("theme_label"),
    themeRegion: text("theme_region"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    // Phase 12 — generic per-row metadata (free_versions cache, near_duplicate_of, …)
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    // V1 enrichment pipeline — see drizzle/0006_enrichment_pipeline.sql.
    // Dedicated OG/twitter columns (separate from `og_title` legacy column,
    // which is kept) so display helpers can fall back deterministically.
    ogDescriptionEnriched: text("og_description_enriched"),
    ogImageUrl: text("og_image_url"),
    ogSiteName: text("og_site_name"),
    canonicalUrl: text("canonical_url"),
    summaryState: text("summary_state").notNull().default("pending"),
    metadataState: text("metadata_state").notNull().default("pending"),
    metadataFetchedAt: timestamp("metadata_fetched_at", { withTimezone: true }),
    metadataAttempts: smallint("metadata_attempts").notNull().default(0),
    metadataLastError: text("metadata_last_error"),
    readerHtml: text("reader_html"),
    readerText: text("reader_text"),
    readerState: text("reader_state").notNull().default("pending"),
    readerFetchedAt: timestamp("reader_fetched_at", { withTimezone: true }),
    videoId: text("video_id"),
    videoThumbnailUrl: text("video_thumbnail_url"),
    videoDurationSeconds: integer("video_duration_seconds"),
    // 0016 — video transcription (Supadata, ADR 0007).
    transcript: text("transcript"),
    transcriptState: text("transcript_state").notNull().default("pending"),
    transcriptSource: text("transcript_source"),
    transcriptLanguage: text("transcript_language"),
    transcriptChars: integer("transcript_chars"),
    transcriptFetchedAt: timestamp("transcript_fetched_at", { withTimezone: true }),
    transcriptAttempts: smallint("transcript_attempts").notNull().default(0),
    transcriptLastError: text("transcript_last_error"),
    longSummary: text("long_summary"),
    longSummaryState: text("long_summary_state").notNull().default("pending"),
    // 0007 — title rescue + embeddings wiring.
    derivedTitle: text("derived_title"),
    embeddingState: text("embedding_state").notNull().default("pending"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    embeddingDimensions: integer("embedding_dimensions"),
    lastClusteredAt: timestamp("last_clustered_at", { withTimezone: true }),
    // 0008 — bookmark date attribution. `bookmarkedAt` is the moment the
    // user originally saved the URL upstream (Telegram message date,
    // Karakeep `bookmark.createdAt`, …). `importedAt` is the moment our
    // import job ran. `createdAt` is the row insert time. Display reads
    // COALESCE(bookmarkedAt, createdAt). `sourcePayload` keeps the raw
    // upstream record so future backfills can re-derive timestamps.
    bookmarkedAt: timestamp("bookmarked_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importSource: text("import_source"),
    sourcePayload: jsonb("source_payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Offline-sync (0018): delta cursor + soft-delete tombstone (ADR-0001/0003).
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("capture_sources_workspace_id_idx").on(table.workspaceId),
    index("capture_sources_state_idx").on(table.state),
    index("capture_sources_kind_idx").on(table.workspaceId, table.kindClassified),
    index("capture_sources_last_opened_idx").on(table.workspaceId, table.lastOpenedAt),
    index("capture_sources_url_host_idx").on(table.urlHost),
    index("capture_sources_staleness_idx").on(table.stalenessScore),
    index("capture_sources_theme_id_idx").on(table.themeId),
    index("capture_sources_theme_region_idx").on(table.themeRegion),
    index("capture_sources_opened_at_idx").on(table.openedAt),
  ]
);

// 0016 — Supadata transcript cache (videoId → transcript). Lets
// re-bookmarking the same video pay zero credits, and lets backfill
// scripts share the same cache as the live pipeline.
export const supadataCache = nexalogSchema.table(
  "supadata_cache",
  {
    videoId: text("video_id").primaryKey(),
    transcript: text("transcript").notNull(),
    language: text("language"),
    source: text("source").notNull(),
    chars: integer("chars").notNull(),
    requestId: text("request_id"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

// Phase 12 — learned per-workspace queue weights (logistic regression).
export const queueWeights = nexalogSchema.table(
  "queue_weights",
  {
    workspaceId: uuid("workspace_id").primaryKey(),
    w1: real("w1").notNull(),
    w2: real("w2").notNull(),
    w3: real("w3").notNull(),
    w4: real("w4").notNull(),
    w5: real("w5").notNull(),
    intercept: real("intercept").notNull().default(0),
    sampleCount: integer("sample_count").notNull().default(0),
    trainedAt: timestamp("trained_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("queue_weights_trained_at_idx").on(table.trainedAt),
  ]
);

// Phase 11 pass 2 — queue learning signals.
export const feedbackSignals = nexalogSchema.table(
  "feedback_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    action: text("action").notNull(), // accept | dismiss | snooze | weekend
    themeId: text("theme_id"),
    kind: text("kind"),
    ageBucket: text("age_bucket"),
    evergreen: boolean("evergreen"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_signals_workspace_id_idx").on(table.workspaceId),
    index("feedback_signals_capture_id_idx").on(table.captureId),
    index("feedback_signals_created_at_idx").on(table.createdAt),
  ]
);

// P7 spaced review — review_schedule table.
export const reviewSchedule = nexalogSchema.table(
  "review_schedule",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).defaultNow().notNull(),
    intervalDays: real("interval_days").notNull().default(1),
    easeFactor: real("ease_factor").notNull().default(2.5),
    reviewCount: integer("review_count").notNull().default(0),
    lastGrade: integer("last_grade"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("review_schedule_workspace_due_idx").on(table.workspaceId, table.nextReviewAt),
    uniqueIndex("review_schedule_capture_unique").on(table.workspaceId, table.captureId),
  ]
);


export const bookmarkCollections = nexalogSchema.table(
  "bookmark_collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description").default(""),
    color: text("color").default("#C07040"),
    icon: text("icon").default("folder"),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Offline-sync (0018): delta cursor + soft-delete tombstone.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("bookmark_collections_workspace_id_idx").on(table.workspaceId),
  ]
);

export const bookmarkTags = nexalogSchema.table(
  "bookmark_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    color: text("color").default("#6366f1"),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bookmark_tags_workspace_id_idx").on(table.workspaceId),
  ]
);

export const captureSourceCollections = nexalogSchema.table(
  "capture_source_collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureSourceId: uuid("capture_source_id").notNull(),
    collectionId: uuid("collection_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("csc_capture_source_id_idx").on(table.captureSourceId),
    index("csc_collection_id_idx").on(table.collectionId),
  ]
);

export const captureSourceTags = nexalogSchema.table(
  "capture_source_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureSourceId: uuid("capture_source_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cst_capture_source_id_idx").on(table.captureSourceId),
    index("cst_tag_id_idx").on(table.tagId),
  ]
);

export const chatSessions = nexalogSchema.table(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New Chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_sessions_workspace_id_idx").on(table.workspaceId),
  ]
);

export const chatMessages = nexalogSchema.table(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_session_id_idx").on(table.sessionId),
  ]
);

export const imports = nexalogSchema.table(
  "imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    filename: text("filename").notNull().default(""),
    status: text("status").notNull().default("processing"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("imports_workspace_id_idx").on(table.workspaceId),
  ]
);

export const extractionCandidates = nexalogSchema.table(
  "extraction_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importId: uuid("import_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    status: text("status").notNull().default("pending"),
    noteId: uuid("note_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("extraction_candidates_import_id_idx").on(table.importId),
    index("extraction_candidates_workspace_id_idx").on(table.workspaceId),
  ]
);

export const noteLinks = nexalogSchema.table(
  "note_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceNoteId: uuid("source_note_id").notNull(),
    targetNoteId: uuid("target_note_id").notNull(),
    kind: text("kind").notNull().default("related"),
    strength: real("strength").default(0.5),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_links_source_idx").on(table.sourceNoteId),
    index("note_links_target_idx").on(table.targetNoteId),
    uniqueIndex("note_links_source_target_uniq").on(table.sourceNoteId, table.targetNoteId),
  ]
);

export const userPreferences = nexalogSchema.table(
  "user_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePlan: text("stripe_plan"),
    stripeSubscriptionStatus: text("stripe_subscription_status"),
    savePageVisits: boolean("save_page_visits").notNull().default(false),
    historyDenylist: text("history_denylist").array().notNull().default([]),
    historyRetentionDays: integer("history_retention_days").notNull().default(90),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_preferences_user_id_idx").on(table.userId),
  ]
);

// Web-history capture — lightweight, separate from capture_sources.
// Never enriched (no OG / LLM / Graphiti). See ADR 0001.
export const pageVisits = nexalogSchema.table(
  "page_visits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    urlHost: text("url_host"),
    title: text("title"),
    visitedAt: timestamp("visited_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("page_visits_workspace_user_idx").on(table.workspaceId, table.userId),
    index("page_visits_url_idx").on(table.url),
    index("page_visits_created_at_idx").on(table.createdAt),
  ]
);

export const coupons = nexalogSchema.table(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    discountPercent: integer("discount_percent").notNull().default(0),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("coupons_code_idx").on(table.code),
  ]
);

export const noteTags = nexalogSchema.table(
  "note_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("note_tags_note_id_idx").on(table.noteId),
    index("note_tags_tag_id_idx").on(table.tagId),
  ]
);

export const pageSnapshots = nexalogSchema.table(
  "page_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull(),
    content: text("content").notNull().default(""),
    rationale: text("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("page_snapshots_note_id_idx").on(table.noteId),
  ]
);

// V1 must-haves — Journal as a first-class feature.
// One entry per user per workspace per day, markdown body, mood/energy 1..5,
// optional weather snapshot, optional voice source ref. Deletion is hard
// (not soft) for now; daily entries are too small to soft-delete.
export const journalEntries = nexalogSchema.table(
  "journal_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    entryDate: date("entry_date").notNull(),
    body: text("body").notNull().default(""),
    mood: smallint("mood"),
    energy: smallint("energy"),
    weatherJson: jsonb("weather_json").$type<Record<string, unknown> | null>(),
    // Voice source ref — nullable text key (R2 audio key, capture id, etc).
    // Kept text + nullable so we don't need a hard FK to a not-yet-real
    // voice_notes table. AGENTS.md mentions the table; when it lands the
    // FK can be tightened in a follow-up migration.
    voiceSourceId: text("voice_source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // Offline-sync (0018): soft-delete tombstone.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("journal_entries_user_workspace_date_idx").on(
      table.userId,
      table.workspaceId,
      table.entryDate,
    ),
    index("journal_entries_workspace_id_idx").on(table.workspaceId),
    index("journal_entries_entry_date_idx").on(table.entryDate),
  ]
);

// 0007 — clustered themes derived from the workspace's enriched corpus.
// One row per (workspaceId, themeId); cluster job replaces wholesale.
export const memoryThemes = nexalogSchema.table(
  "memory_themes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    themeId: text("theme_id").notNull(),
    label: text("label").notNull(),
    size: integer("size").notNull().default(0),
    centroid: jsonb("centroid").$type<number[] | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("memory_themes_workspace_theme_idx").on(
      table.workspaceId,
      table.themeId,
    ),
    index("memory_themes_workspace_id_idx").on(table.workspaceId),
    index("memory_themes_computed_at_idx").on(table.computedAt),
  ]
);

export const broadcastMessages = nexalogSchema.table(
  "broadcast_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// NEXALOG-PROJECTS — Project = reference-based container grouping existing
// notes/bookmarks/journal units. Nexalog owns this registry (SSOT). Plexo
// holds brainstorm Work history keyed by project id via plexoSessionId, never
// a copy of the registry. See plans/projects/adr/0001-nexalog-projects.md.
export const projects = nexalogSchema.table(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // lifecycle: 'draft' | 'active' | 'archived'
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    livingDoc: text("living_doc").notNull().default(""),
    livingDocUpdatedAt: timestamp("living_doc_updated_at", { withTimezone: true }),
    // Pointer to the Plexo Work/conversation thread (channelRef.channelId = id).
    // NOT a copy of brainstorm history — that lives Plexo-side.
    plexoSessionId: text("plexo_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_workspace_id_idx").on(table.workspaceId),
    index("projects_user_id_idx").on(table.userId),
    index("projects_lifecycle_state_idx").on(table.lifecycleState),
  ]
);

// Grouping by reference. itemKind: see `ProjectItemKind` below. No FK on
// item_id (polymorphic) — ownership enforced in the validated link path.
// `item_kind = 'project'` means the reference target is another PROJECT row:
// that is how sub-projects are expressed (ADR-0018 reference-based containers;
// the nesting policy — one parent, two levels — lives in `@/lib/projects/domain`
// and is enforced in the write path, never by a CHECK constraint).
export type ProjectItemKind = "note" | "bookmark" | "journal" | "project";

export const projectItems = nexalogSchema.table(
  "project_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    itemKind: text("item_kind").$type<ProjectItemKind>().notNull(),
    itemId: uuid("item_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_items_uidx").on(table.projectId, table.itemKind, table.itemId),
    index("project_items_project_id_idx").on(table.projectId),
    index("project_items_item_idx").on(table.itemKind, table.itemId),
  ]
);

// Discovered (proposed) projects from an AI-conversation import, awaiting
// review. Clustering over conversation embeddings proposes these; the user
// confirms/dismisses before a real `projects` row is created. See
// drizzle/0015_project_candidates.sql. `memberNoteIds` = the cluster's
// Ideas — first-class idea taxonomy (ADR-0008). Distinct from
// extraction_candidates (per-import review queue): ideas are durable
// objects on three orthogonal axes — shape × maturity × provenance —
// embedded for semantic recall, FTS-indexed, optionally ingested into
// the workspace's Graphiti graph. The `embedding vector(384)` column +
// generated `fts tsvector` column + check constraints live in
// drizzle/0017_ideas.sql and aren't declared here (Drizzle can't
// express either today; raw SQL is the source of truth).
export const ideas = nexalogSchema.table(
  "ideas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // 'observation' | 'question' | 'claim' | 'principle' | 'method' | 'story' | 'heuristic'
    shape: text("shape").notNull(),
    // 'spark' | 'kernel' | 'formed' | 'tested' | 'applied'
    maturity: text("maturity").notNull().default("spark"),
    // 'extracted' | 'curated' | 'synthesized'
    provenance: text("provenance").notNull(),
    // 'note' | 'bookmark' | 'transcript' | 'conversation' | 'cluster' | null
    sourceKind: text("source_kind"),
    sourceId: uuid("source_id"),
    sourceLabel: text("source_label"),
    themeId: text("theme_id"),
    promotedFromCandidateId: uuid("promoted_from_candidate_id"),
    // Embedding workflow state. The `embedding vector(384)` column itself
    // exists in DB only (see migration). Workers update embeddingState.
    embeddingState: text("embedding_state").notNull().default("pending"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    embeddingDimensions: integer("embedding_dimensions"),
    // graphEpisodeId removed (P10 ADR-0013: dead column, never wired, migration 0023)
    // 'active' | 'archived' | 'dismissed'
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ideas_workspace_created_at_idx").on(table.workspaceId, table.createdAt),
    index("ideas_workspace_shape_idx").on(table.workspaceId, table.shape),
    index("ideas_workspace_maturity_idx").on(table.workspaceId, table.maturity),
    index("ideas_workspace_provenance_idx").on(table.workspaceId, table.provenance),
    index("ideas_source_idx").on(table.sourceKind, table.sourceId),
    index("ideas_workspace_theme_idx").on(table.workspaceId, table.themeId),
  ]
);

// conversation notes.
export const projectCandidates = nexalogSchema.table(
  "project_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importId: uuid("import_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    memberNoteIds: jsonb("member_note_ids").$type<string[]>().notNull().default([]),
    // 'pending' | 'accepted' | 'dismissed'
    status: text("status").notNull().default("pending"),
    projectId: uuid("project_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("project_candidates_workspace_id_idx").on(table.workspaceId),
    index("project_candidates_import_id_idx").on(table.importId),
    index("project_candidates_status_idx").on(table.status),
  ]
);

// Offline-sync (0018) — idempotency ledger for POST /api/sync/mutations.
// A previously-seen opId is a replay → no-op (ADR-0001). Scoped per user.
export const syncMutationLog = nexalogSchema.table(
  "sync_mutation_log",
  {
    opId: text("op_id").primaryKey(),
    userId: text("user_id").notNull(),
    entity: text("entity").notNull(),
    op: text("op").notNull(),
    targetId: text("target_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sync_mutation_log_user_id_idx").on(table.userId),
  ]
);

// P4 (0020) — saved smart-views: user-named DSL queries surfaced on /today.
// query stores the raw DSL string (kind:note age:7d sort:recency …).
// Migration 0020_query_views.sql — operator-gated.
export const queryViews = nexalogSchema.table(
  "query_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("query_views_workspace_id_idx").on(table.workspaceId),
  ]
);

// P9 (0022) — typed objects: user-defined entity kinds (Book, Person, Meeting …).
// schema_json holds a JSON Schema for the kind's fields (validated at API boundary).
// Migration 0022_typed_objects.sql — operator-gated.
export const typedObjectKinds = nexalogSchema.table(
  "typed_object_kinds",
  {
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    schemaJson: jsonb("schema_json").$type<Record<string, unknown>>().notNull().default({}),
    icon: text("icon"),
  }
);

export const typedObjects = nexalogSchema.table(
  "typed_objects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // fts tsvector column exists in DB (generated); not declared in Drizzle
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("typed_objects_workspace_kind_idx").on(table.workspaceId, table.kind),
  ]
);

// P2-fb: snooze + weekend feedback create a queue_state row that filters the
// next queue load until due_at passes. The feedbackSignals row is still
// written for the regression learner — this table is a behavioural mirror.
export const queueState = nexalogSchema.table(
  "queue_state",
  {
    workspaceId: text("workspace_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    source: text("source").notNull(), // 'snooze' | 'weekend'
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.captureId, table.source] }),
    index("queue_state_due_idx").on(table.workspaceId, table.dueAt),
  ]
);

// U6 (0025) — typed object templates: named defaults per (workspace, kind).
// Migration 0025_typed_object_templates.sql — operator-gated.
export const typedObjectTemplates = nexalogSchema.table(
  "typed_object_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("typed_object_templates_workspace_kind_idx").on(table.workspaceId, table.kind),
    uniqueIndex("typed_object_templates_workspace_kind_name_idx").on(
      table.workspaceId,
      table.kind,
      table.name,
    ),
  ]
);
