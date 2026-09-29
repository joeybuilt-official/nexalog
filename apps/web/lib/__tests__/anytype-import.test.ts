// SPDX-License-Identifier: MIT
/**
 * AnyType Markdown-export parser + planner (`lib/import/anytype.ts`).
 *
 * Every case here is derived from the documented exporter behaviour: identity lives in the
 * frontmatter `id` (never the filename), property display names are user-defined, the object
 * title is the body H1, and a slug is only usable if the app's own `Slug.of` accepts it.
 * Nothing in this file touches the filesystem, a database, or a brain repo.
 */
import { describe, it, expect } from "vitest";
import { Slug } from "@nexalog/core";
import {
  attachmentPath,
  attachmentShard,
  buildPlan,
  collectBodyFileRefs,
  collectFrontmatterFileRefs,
  deriveSlug,
  isValidSlugPath,
  mapAnytypeType,
  normalizeTypeLabel,
  parseAnytypeExportFile,
  parseAnytypeFrontmatter,
  pickCreatedAt,
  pickUpdatedAt,
  pickUrl,
  redactEmailTokens,
  rewriteBodyFileRefs,
  senderToken,
  serializePageFile,
  shortHash,
  slugify,
  slugifyTitle,
  splitAnytypeFrontmatter,
  toDate,
  uncollapseAddress,
  type AnytypeObject,
  type PlanContext,
} from "@/lib/import/anytype";

const ID_NOTE = "bafyreifakenote7xq3k5v2m4p6r8s0t2u4w6y8z0a2c4e6g8i0k2m4o6q";
const ID_PAGE = "bafyreifakepage9z1b3d5f7h9j1l3n5p7r9t1v3x5z7b9d1f3h5j7l9n";
const ID_BOOKMARK = "bafyreifakebookmark1a3c5e7g9i1k3m5o7q9s1u3w5y7a9c1e3g5i7k9m";
const IMPORTED_AT = new Date("2026-09-27T12:00:00.000Z");

/** A file in the exact shape the exporter writes (3-trailing-space hard breaks included). */
function noteFile(overrides: { frontmatter?: string[]; body?: string[] } = {}): string {
  return [
    "---",
    "# yaml-language-server: $schema=schemas/note.schema.json",
    ...(overrides.frontmatter ?? [
      "Object type: Note",
      "Tags:",
      "    - ideas",
      "    - inbox",
      'Created: "2026-09-20"',
      'Last modified: "2026-09-24T14:05:00Z"',
      `id: ${ID_NOTE}`,
    ]),
    "---",
    "",
    ...(overrides.body ?? ["# My First Note   ", "", "Body text.   "]),
    "",
  ].join("\n");
}

function planCtx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    existingCaptureUrls: new Set<string>(),
    existingPages: new Map<string, string | null>(),
    availableAttachments: new Set<string>(),
    existingAttachments: new Set<string>(),
    importedAt: IMPORTED_AT,
    importSource: "anytype",
    ...overrides,
  };
}

function parseAs(frontmatter: string[], body: string[], fileName = "x.md"): AnytypeObject {
  return parseAnytypeExportFile(
    ["---", ...frontmatter, "---", "", ...body, ""].join("\n"),
    fileName,
  );
}

describe("parseAnytypeExportFile — frontmatter", () => {
  it("takes identity from the frontmatter id, never from the filename", () => {
    const object = parseAnytypeExportFile(noteFile(), "some-other-name.md");
    expect(object.id).toBe(ID_NOTE);
    expect(object.sourceFileName).toBe("some-other-name.md");
  });

  it("returns a null id — not the filename — when the frontmatter has no id", () => {
    const text = noteFile({ frontmatter: ["Object type: Note", 'Created: "2026-09-20"'] });
    const object = parseAnytypeExportFile(text, "looks-like-an-id.md");
    expect(object.id).toBeNull();
    expect(object.frontmatterFound).toBe(true);
  });

  it("reads the Object type property as the type label", () => {
    expect(parseAnytypeExportFile(noteFile(), "x.md").rawType).toBe("Note");
  });

  it("falls back to the language-server schema ref when the type property is absent", () => {
    const object = parseAnytypeExportFile(
      noteFile({ frontmatter: ["Tags:", "    - ideas", `id: ${ID_NOTE}`] }),
      "x.md",
    );
    expect(object.rawType).toBe("note");
    expect(object.schemaRef).toBe("schemas/note.schema.json");
  });

  it("treats the language-server line as a comment, not a property", () => {
    const { frontmatter } = parseAnytypeFrontmatter(
      "# yaml-language-server: $schema=schemas/note.schema.json\nObject type: Note",
    );
    expect(Object.keys(frontmatter)).toEqual(["Object type"]);
  });

  it("types scalars: quoted dates stay strings, booleans and numbers are typed", () => {
    const { frontmatter } = parseAnytypeFrontmatter(
      ['Due date: "2026-09-25"', "Done: true", "Archived: false", "Effort (hours): 12.5", "Note: ~"].join(
        "\n",
      ),
    );
    expect(frontmatter["Due date"]).toBe("2026-09-25");
    expect(frontmatter.Done).toBe(true);
    expect(frontmatter.Archived).toBe(false);
    expect(frontmatter["Effort (hours)"]).toBe(12.5);
    expect(frontmatter.Note).toBeNull();
  });

  it("parses a block sequence into a string array", () => {
    const { frontmatter } = parseAnytypeFrontmatter("Tags:\n    - ideas\n    - inbox");
    expect(frontmatter.Tags).toEqual(["ideas", "inbox"]);
  });

  it("keeps a value containing a colon intact", () => {
    const { frontmatter } = parseAnytypeFrontmatter("Source: https://example.com/spec");
    expect(frontmatter.Source).toBe("https://example.com/spec");
  });

  it("folds a plain scalar wrapped over indented continuation lines", () => {
    const { frontmatter, warnings } = parseAnytypeFrontmatter(
      "Description: This value was wrapped by the exporter because it is\n    longer than the line width\nCreated: \"2026-08-04\"",
    );
    expect(frontmatter.Description).toBe(
      "This value was wrapped by the exporter because it is longer than the line width",
    );
    expect(frontmatter.Created).toBe("2026-08-04");
    expect(warnings).toEqual([]);
  });

  it("records a warning instead of throwing on an unparseable line", () => {
    const { frontmatter, warnings } = parseAnytypeFrontmatter("just-a-bare-word\nObject type: Note");
    expect(frontmatter["Object type"]).toBe("Note");
    expect(warnings).toHaveLength(1);
  });
});

describe("parseAnytypeExportFile — body, title, URLs", () => {
  it("uses the body H1 as the title and strips it from the body", () => {
    const object = parseAnytypeExportFile(noteFile(), "x.md");
    expect(object.title).toBe("My First Note");
    expect(object.body.startsWith("# ")).toBe(false);
    expect(object.body).toBe("Body text.");
  });

  it("keeps a body without an H1 verbatim", () => {
    const object = parseAnytypeExportFile(
      noteFile({ body: ["No heading here.   ", "", "Second paragraph."] }),
      "x.md",
    );
    expect(object.title).toBe("x");
    expect(object.body).toBe("No heading here.   \n\nSecond paragraph.");
  });

  it("falls back to a name property, then a markdown link label, then the filename stem", () => {
    const fromName = parseAs(
      ["Object type: Note", "Name: Named In Frontmatter", `id: ${ID_NOTE}`],
      ["no heading"],
    );
    expect(fromName.title).toBe("Named In Frontmatter");

    const fromLink = parseAs(
      ["Object type: Bookmark", "Source: https://anytype.io/docs", `id: ${ID_BOOKMARK}`],
      ["[Anytype Docs](https://anytype.io/docs)    "],
      "read-later-bookmark.md",
    );
    expect(fromLink.title).toBe("Anytype Docs");

    const fromStem = parseAs(
      ["Object type: Note", `id: ${ID_NOTE}`],
      ["no heading and no link"],
      "my-first-note.md",
    );
    expect(fromStem.title).toBe("my-first-note");
  });

  it("collects URLs from frontmatter values and from the body", () => {
    const object = parseAnytypeExportFile(noteFile(), "x.md");
    expect(object.frontmatterUrls).toEqual([]);
    const withUrls = parseAnytypeExportFile(
      noteFile({
        frontmatter: [
          "Object type: Bookmark",
          "Source: https://example.com/a",
          "Mirror: https://example.com/b",
          `id: ${ID_BOOKMARK}`,
        ],
        body: ["# T   ", "", "[x](https://example.com/c)    ", "", "bare https://example.com/d here"],
      }),
      "x.md",
    );
    expect(withUrls.frontmatterUrls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(withUrls.bodyUrls).toEqual(["https://example.com/c", "https://example.com/d"]);
  });

  it("does not throw on a file with no frontmatter block, and says so", () => {
    const object = parseAnytypeExportFile("# Body Only\n\nText.\n", "body-only.md");
    expect(object.frontmatterFound).toBe(false);
    expect(object.id).toBeNull();
    expect(object.warnings.join(" ")).toContain("no frontmatter block");
  });

  it("does not throw on an unterminated frontmatter block", () => {
    const object = parseAnytypeExportFile("---\nid: abc\n# no closing delimiter\n", "broken.md");
    expect(object.frontmatterFound).toBe(false);
    expect(object.warnings.join(" ")).toContain("unterminated");
  });

  it("round-trips: splitAnytypeFrontmatter recovers the block it was given", () => {
    const text = noteFile();
    const { frontmatterText, body } = splitAnytypeFrontmatter(text);
    expect(frontmatterText).not.toBeNull();
    expect(frontmatterText?.startsWith("# yaml-language-server")).toBe(true);
    expect(body.startsWith("\n# My First Note")).toBe(true);
  });
});

describe("slugify / deriveSlug / isValidSlugPath", () => {
  it("folds non-ASCII down to ASCII", () => {
    expect(slugify("Émoji Naïve Zürich")).toBe("emoji-naive-zurich");
  });

  it("collapses punctuation runs into single dashes and strips the edges", () => {
    expect(slugify("  Hello,   World!!  ")).toBe("hello-world");
    expect(slugify("—leading dash—")).toBe("leading-dash");
  });

  it("keeps digits, dots, underscores and dashes", () => {
    expect(slugify("v2.0_release-notes")).toBe("v2-0-release-notes");
  });

  it("returns the empty string for a title with no usable characters", () => {
    expect(slugify("...")).toBe("");
    expect(slugify("…—…")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("never contains a slash, a leading dot, or an uppercase letter", () => {
    const nasty = ["a/b/c", "../../etc/passwd", ".hidden", "/abs/path", "UPPER Case", "a\\b"];
    for (const title of nasty) {
      const slug = slugify(title);
      expect(slug.includes("/")).toBe(false);
      expect(slug.startsWith(".")).toBe(false);
      expect(slug).toBe(slug.toLowerCase());
    }
  });

  it("caps the slug at the exporter's own 48-character truncation", () => {
    expect(slugify("x".repeat(200))).toHaveLength(48);
    expect(slugify(`${"word ".repeat(30)}`).length).toBeLessThanOrEqual(48);
  });

  it("produces only paths the app's own Slug.of accepts (it throws, it does not sanitize)", () => {
    const titles = [
      "My First Note",
      "Émoji & Sp€cial / Chars … 100% (v2)",
      "Tricky # Bookmark: With Colons",
      "2019-01-01",
      "- dash",
      "..",
      "Ünïcödé Ñoïse",
      "a".repeat(120),
    ];
    for (const title of titles) {
      const slug = slugify(title);
      if (slug === "") continue;
      const path = `notes/${slug}`;
      expect(isValidSlugPath(path)).toBe(true);
      expect(() => Slug.of(path)).not.toThrow();
    }
  });

  it("mirrors Slug.of exactly — including the normalization it applies first", () => {
    expect(isValidSlugPath("notes/ok-slug")).toBe(true);
    // Slug.of() lowercases and strips a trailing slash BEFORE validating, so both of these
    // are accepted (and normalized) rather than rejected — the guard must not be stricter
    // than the thing it is protecting.
    expect(isValidSlugPath("notes/Uppercase")).toBe(true);
    expect(isValidSlugPath("notes/")).toBe(true);
    // These are the real failures: characters and shapes Slug.of has no rule for.
    expect(isValidSlugPath("notes/has space")).toBe(false);
    expect(isValidSlugPath("notes/.hidden")).toBe(false);
    expect(isValidSlugPath("notes/ünïcode")).toBe(false);
    expect(isValidSlugPath("")).toBe(false);
    expect(() => Slug.of("notes/has space")).toThrow(/Invalid slug segment/);
  });

  it("falls back to the object id when the title yields nothing", () => {
    expect(deriveSlug("..", "bafyreiEDGE0002dots0002")).toBe("anytype-bafyreiEDGE0002d".toLowerCase());
    expect(deriveSlug("My Note", "whatever")).toBe("my-note");
    expect(deriveSlug("...", "...")).toBeNull();
  });
});

describe("mapAnytypeType", () => {
  it("maps prose types to the conventional brain directories", () => {
    expect(mapAnytypeType("Note")).toEqual({ disposition: "page", pageType: "note", dir: "notes" });
    expect(mapAnytypeType("Page")).toEqual({ disposition: "page", pageType: "note", dir: "notes" });
    expect(mapAnytypeType("Concept")).toEqual({
      disposition: "page",
      pageType: "concept",
      dir: "concepts",
    });
    expect(mapAnytypeType("Person")).toEqual({
      disposition: "page",
      pageType: "person",
      dir: "people",
    });
    expect(mapAnytypeType("Company")).toEqual({
      disposition: "page",
      pageType: "company",
      dir: "companies",
    });
    expect(mapAnytypeType("Project")).toEqual({
      disposition: "page",
      pageType: "project",
      dir: "projects",
    });
  });

  it("maps bookmark-shaped types to capture_sources rows", () => {
    for (const label of ["Bookmark", "Link", "URL", "bookmark"]) {
      expect(mapAnytypeType(label).disposition).toBe("capture");
    }
  });

  it("refuses types with no Nexalog destination instead of guessing one", () => {
    for (const label of ["Task", "Collection", "Set", "Template", "Custom Widget", null]) {
      expect(mapAnytypeType(label).disposition).toBe("unsupported");
    }
  });

  it("normalizes the schema-ref spelling of a type label", () => {
    expect(normalizeTypeLabel("My_Type Name")).toBe("my type name");
    expect(normalizeTypeLabel(null)).toBeNull();
  });
});

describe("dates", () => {
  it("accepts the exporter's date-only and date+time forms", () => {
    expect(toDate("2026-09-25")?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(toDate("2026-09-24T14:05:00Z")?.toISOString()).toBe("2026-09-24T14:05:00.000Z");
  });

  it("rejects anything that is not a plausible date", () => {
    expect(toDate("not a date")).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(true)).toBeNull();
    expect(toDate("0001-01-01")).toBeNull(); // outside 1970–2100
    expect(toDate("2999-01-01")).toBeNull();
  });

  it("finds the created/modified dates under user-renamed property labels", () => {
    expect(pickCreatedAt({ "Created at": "2026-01-02" })?.toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(pickCreatedAt({ "Date created": "2026-01-03" })?.toISOString()).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    expect(pickCreatedAt({ Tags: ["x"] })).toBeNull();
    expect(pickUpdatedAt({ "Last modified": "2026-09-24T14:05:00Z" })?.toISOString()).toBe(
      "2026-09-24T14:05:00.000Z",
    );
  });
});

describe("pickUrl", () => {
  it("prefers a frontmatter URL over a body URL", () => {
    const object = parseAnytypeExportFile(
      noteFile({
        frontmatter: ["Object type: Bookmark", "Source: https://a.example/x", `id: ${ID_BOOKMARK}`],
        body: ["# T   ", "", "[b](https://b.example/y)"],
      }),
      "x.md",
    );
    expect(pickUrl(object)).toBe("https://a.example/x");
  });

  it("returns null when neither side has a URL", () => {
    expect(pickUrl(parseAnytypeExportFile(noteFile(), "x.md"))).toBeNull();
  });
});

describe("buildPlan — captures", () => {
  const bookmark = (id: string, url: string, created: string, file: string) =>
    parseAs(
      [
        "# yaml-language-server: $schema=schemas/bookmark.schema.json",
        "Object type: Bookmark",
        `Source: ${url}`,
        `Created: "${created}"`,
        `id: ${id}`,
      ],
      ["# A Bookmark   ", ""],
      file,
    );

  it("plans an INSERT with the app's own URL classification and the preserved save date", () => {
    const plan = buildPlan(
      [bookmark(ID_BOOKMARK, "https://www.youtube.com/watch?v=abc", "2026-09-22", "b.md")],
      planCtx(),
    );
    expect(plan.captures).toHaveLength(1);
    const capture = plan.captures[0];
    expect(capture.action).toBe("INSERT");
    expect(capture.kindClassified).toBe("video");
    expect(capture.urlHost).toBe("www.youtube.com");
    expect(capture.bookmarkedAt?.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(capture.payload.anytype).toMatchObject({ id: ID_BOOKMARK, type: "Bookmark" });
  });

  it("inserts with a NULL bookmarked_at (and says so) when there is no created date", () => {
    const object = parseAs(
      [
        "Object type: Bookmark",
        "Source: https://example.com/x",
        `id: ${ID_BOOKMARK}`,
      ],
      ["# T   ", ""],
      "b.md",
    );
    const plan = buildPlan([object], planCtx());
    expect(plan.captures[0].action).toBe("INSERT");
    expect(plan.captures[0].bookmarkedAt).toBeNull();
    expect(plan.captures[0].reason).toContain("bookmarked_at stays NULL");
  });

  it("normalizes the URL before comparing and storing it", () => {
    const plan = buildPlan(
      [bookmark(ID_BOOKMARK, "https://Example.com/x/?utm_source=n&b=2#frag", "2026-09-22", "b.md")],
      planCtx(),
    );
    expect(plan.captures[0].url).toBe("https://example.com/x?b=2");
  });

  it("skips a URL that already exists in the workspace (no unique constraint on url)", () => {
    const plan = buildPlan(
      [bookmark(ID_BOOKMARK, "https://example.com/x", "2026-09-22", "b.md")],
      planCtx({ existingCaptureUrls: new Set(["https://example.com/x"]) }),
    );
    expect(plan.captures[0].action).toBe("SKIP-duplicate");
    expect(plan.captures[0].reason).toContain("already has this URL");
    expect(plan.captures.filter((c) => c.action === "INSERT")).toHaveLength(0);
  });

  it("collapses duplicate URLs inside one export, keeping the earliest date", () => {
    const plan = buildPlan(
      [
        bookmark("id-one", "https://example.com/x", "2026-09-25", "a.md"),
        bookmark("id-two", "https://example.com/x", "2026-09-22", "b.md"),
        bookmark("id-three", "https://example.com/x", "2026-09-24", "c.md"),
      ],
      planCtx(),
    );
    const inserted = plan.captures.filter((c) => c.action === "INSERT");
    expect(inserted).toHaveLength(1);
    expect(inserted[0].sourceFileName).toBe("b.md");
    expect(inserted[0].bookmarkedAt?.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(plan.captures.filter((c) => c.action === "SKIP-duplicate")).toHaveLength(2);
    expect(plan.captures.every((c) => c.url === "https://example.com/x")).toBe(true);
    // No object is silently lost: every parsed object appears exactly once in the plan.
    expect(plan.captures.length + plan.skips.length).toBe(3);
    expect(plan.captures.map((c) => c.sourceFileName).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("skips a Bookmark with no URL at all", () => {
    const plan = buildPlan(
      [parseAs(["Object type: Bookmark", `id: ${ID_BOOKMARK}`], ["# No URL   ", ""], "bad.md")],
      planCtx(),
    );
    expect(plan.captures).toHaveLength(0);
    expect(plan.skips[0].reason).toContain("no http(s) URL");
  });

  it("skips a Bookmark whose URL is not http(s) after normalization", () => {
    const plan = buildPlan(
      [
        parseAs(
          ["Object type: Bookmark", "Source: javascript:alert(1)", `id: ${ID_BOOKMARK}`],
          ["# T   ", ""],
          "bad.md",
        ),
      ],
      planCtx(),
    );
    // `javascript:` is not collected as a URL at all, so it reads as "no URL".
    expect(plan.skips).toHaveLength(1);
  });
});

describe("buildPlan — pages", () => {
  const note = (id: string, title: string, file: string) =>
    parseAs(
      [
        "# yaml-language-server: $schema=schemas/note.schema.json",
        "Object type: Note",
        'Created: "2026-09-20"',
        `id: ${id}`,
      ],
      [`# ${title}   `, "", "Body text.   "],
      file,
    );

  it("plans a WRITE to the mapped directory with only the documented frontmatter keys", () => {
    const plan = buildPlan([note(ID_NOTE, "My First Note", "a.md")], planCtx());
    expect(plan.pages).toHaveLength(1);
    const page = plan.pages[0];
    expect(page.action).toBe("WRITE");
    expect(page.relPath).toBe("notes/my-first-note.md");
    expect(page.pageType).toBe("note");
    expect(Object.keys(page.frontmatter)).toEqual([
      "type",
      "title",
      "anytype_id",
      "import_source",
      "imported_at",
      "date",
      "anytype_type",
      "anytype_created_at",
    ]);
    expect(page.frontmatter.title).toBe("My First Note");
    expect(page.frontmatter.imported_at).toBe(IMPORTED_AT.toISOString());
    // The brain's date extractor reads `date`; `anytype_created_at` alone is invisible to it.
    expect(page.frontmatter.date).toBe("2026-09-20T00:00:00.000Z");
  });

  it("routes each prose type into its conventional directory", () => {
    const person = parseAs(["Object type: Person", `id: ${ID_NOTE}`], ["# Ada   ", ""], "p.md");
    const plan = buildPlan([person], planCtx());
    expect(plan.pages[0].relPath).toBe("people/ada.md");
    expect(plan.pages[0].pageType).toBe("person");
  });

  it("skips a page whose destination already exists and was not written by this importer", () => {
    const plan = buildPlan(
      [note(ID_NOTE, "My First Note", "a.md")],
      planCtx({ existingPages: new Map([["notes/my-first-note.md", "some-other-id"]]) }),
    );
    expect(plan.pages[0].action).toBe("SKIP-duplicate");
    expect(plan.pages[0].reason).toContain("refusing to overwrite");
  });

  it("skips a page already imported from the same AnyType object (anytype_id matches)", () => {
    const plan = buildPlan(
      [note(ID_NOTE, "My First Note", "a.md")],
      planCtx({ existingPages: new Map([["notes/my-first-note.md", ID_NOTE]]) }),
    );
    expect(plan.pages[0].action).toBe("SKIP-duplicate");
    expect(plan.pages[0].reason).toContain("already imported");
  });

  it("gives a slug collision a suffixed path so neither page is clobbered", () => {
    const plan = buildPlan(
      [note("id-one-a1", "Ada Lovelace", "a.md"), note("id-two-b2", "Ada Lovelace", "b.md")],
      planCtx(),
    );
    expect(plan.pages.map((p) => p.relPath).sort()).toEqual([
      "notes/ada-lovelace-two-b2.md", // suffixed with the last 6 chars of the second object's id
      "notes/ada-lovelace.md",
    ]);
    expect(plan.pages.every((p) => p.action === "WRITE")).toBe(true);
    expect(plan.pages[1].reason).toContain("slug collision");
  });

  it("skips an object with no id, and never derives one from the filename", () => {
    const plan = buildPlan(
      [
        parseAnytypeExportFile(
          ["---", "Object type: Note", 'Created: "2026-09-20"', "---", "", "# Title   ", ""].join(
            "\n",
          ),
          "title.md",
        ),
      ],
      planCtx(),
    );
    expect(plan.pages).toHaveLength(0);
    expect(plan.skips[0].reason).toContain('no "id"');
  });

  it("skips unsupported types with the type name in the reason, and still counts them", () => {
    const plan = buildPlan(
      [parseAs(["Object type: Task", `id: ${ID_NOTE}`], ["# Buy Milk   ", ""], "task.md")],
      planCtx(),
    );
    expect(plan.skips[0].reason).toContain('unsupported AnyType type "Task"');
    expect(plan.typeCounts).toEqual([{ rawType: "Task", count: 1 }]);
  });

  it("counts every parsed object once, by its raw type label", () => {
    const plan = buildPlan(
      [note(ID_NOTE, "One", "a.md"), note(ID_PAGE, "Two", "b.md")],
      planCtx(),
    );
    expect(plan.typeCounts).toEqual([{ rawType: "Note", count: 2 }]);
  });
});

describe("email addresses in a title never become a slug", () => {
  // Synthetic senders only. A test file in a PUBLIC repo is a publication surface, so the real
  // third-party addresses the sanitizer was written for appear here in shape, never in fact.
  const SENDER_A = "quinntalty@example.com";
  const SENDER_B = "robinhale@example.com";
  const COLLAPSED_A = "quinntaltyatexample-com"; // what slug.Make leaves for SENDER_A
  const COLLAPSED_B = "robinhaleatexample-com";

  it("replaces a literal address with a neutral token", () => {
    const token = senderToken(SENDER_A);
    expect(token.startsWith("sender-")).toBe(true);
    expect(token).toBe(`sender-${shortHash(SENDER_A)}`);
    expect(redactEmailTokens(`Fwd from ${SENDER_A} about merch`)).toBe(
      `Fwd from ${token} about merch`,
    );
    expect(redactEmailTokens(`Fwd from ${SENDER_A} about merch`)).not.toContain("@");
  });

  it("replaces the collapsed form the exporter's own namer produces", () => {
    expect(senderToken(uncollapseAddress(COLLAPSED_A))).toBe(senderToken(SENDER_A));
    expect(redactEmailTokens(COLLAPSED_A)).toBe(senderToken(SENDER_A));
    expect(redactEmailTokens(`re-${COLLAPSED_A}-hello`)).toBe(
      `re-${senderToken(SENDER_A)}-hello`,
    );
  });

  it("is deterministic: the same title always yields the same token and slug", () => {
    const title = `${COLLAPSED_A}-thank-you-for-reaching-out`;
    expect(redactEmailTokens(title)).toBe(redactEmailTokens(title));
    expect(slugifyTitle(title)).toBe(slugifyTitle(title));
    expect(deriveSlug(title, ID_NOTE)).toBe(deriveSlug(title, ID_NOTE));
  });

  it("never lets two senders share a token or a slug", () => {
    expect(senderToken(SENDER_A)).not.toBe(senderToken(SENDER_B));
    expect(redactEmailTokens(`${COLLAPSED_A}-hi`)).not.toBe(redactEmailTokens(`${COLLAPSED_B}-hi`));
    expect(slugifyTitle(`${COLLAPSED_A}-hi`)).not.toBe(slugifyTitle(`${COLLAPSED_B}-hi`));
  });

  it("strips the address out of the slug and the remaining path stays legal", () => {
    for (const title of [
      `${COLLAPSED_A}-dustin-thank-you-for-reaching-out`,
      `${COLLAPSED_B}-hello-my-application-was-received`,
      `Fwd: ${SENDER_A}`,
    ]) {
      const slug = deriveSlug(title, ID_NOTE);
      expect(slug).not.toBeNull();
      expect(slug).not.toContain("@");
      expect(slug).not.toContain("example");
      expect(slug).not.toContain("atgmail");
      expect(isValidSlugPath(`notes/${slug}`)).toBe(true);
      expect(() => Slug.of(`notes/${slug}`)).not.toThrow();
    }
  });

  it("leaves ordinary titles untouched", () => {
    for (const title of [
      "Clean garage",
      "Q3 planning notes",
      "Read later",
      "Invoice 5280",
      "Meeting notes for the team",
      "Attachment handling",
      "Get started",
    ]) {
      expect(redactEmailTokens(title)).toBe(title);
      expect(slugifyTitle(title)).toBe(slugify(title));
    }
  });

  it("is total: an empty title stays empty and yields no slug", () => {
    expect(redactEmailTokens("")).toBe("");
    expect(slugifyTitle("")).toBe("");
    expect(deriveSlug("", "")).toBeNull();
  });

  it("still gives the object a slug when the sanitized title is all there is", () => {
    // The token itself is slug-safe (`sender-` + hex), so a title that is nothing but an address
    // produces a usable filename instead of falling through to the id.
    expect(slugifyTitle(SENDER_A)).toBe(slugify(senderToken(SENDER_A)));
  });
});

describe("attachment references", () => {
  it("collects body refs in document order, deduped, and frontmatter refs whole-value only", () => {
    const body = [
      "![one](files/one.png)   ",
      "[doc](files/report.pdf)   ",
      "![again](files/one.png)   ",
      "a prose mention of files/prose-only.png inside a sentence",
    ].join("\n");
    expect(collectBodyFileRefs(body)).toEqual(["files/one.png", "files/report.pdf"]);

    expect(
      collectFrontmatterFileRefs({
        "Outgoing links": ["files/one.png", "some-other-page.md", "Someone", "files/one.png"],
        Image: "files/cover.jpg",
        Description: "mentions files/nope.png in prose",
      }),
    ).toEqual(["files/one.png", "files/cover.jpg"]);
  });

  it("names the copy after the page slug so a shared file name cannot collide", () => {
    expect(attachmentPath("2026/03", "photo-roundup", "files/image.png")).toBe(
      "attachments/2026/03/photo-roundup-image.png",
    );
    // No extension is not a decision point — the exporter writes real images without one.
    expect(attachmentPath("2026/03", "photo-roundup", "files/no-extension-image")).toBe(
      "attachments/2026/03/photo-roundup-no-extension-image",
    );
  });

  it("cannot escape the attachments directory from a hostile reference name", () => {
    const path = attachmentPath("2026/03", "page", "files/../../etc/passwd");
    expect(path.startsWith("attachments/2026/03/page-")).toBe(true);
    expect(path.includes("..")).toBe(false);
  });

  it("shards by the object's own date, falling back to the run date", () => {
    expect(attachmentShard(new Date("2026-03-04T05:06:07Z"), IMPORTED_AT)).toBe("2026/03");
    expect(attachmentShard(new Date("2024-12-31T23:59:59Z"), IMPORTED_AT)).toBe("2024/12");
    expect(attachmentShard(null, IMPORTED_AT)).toBe("2026/09");
  });

  it("rewrites only the refs that have a destination", () => {
    const body = "![a](files/a.png)   \n![b](files/b.png)   ";
    const rewritten = rewriteBodyFileRefs(body, new Map([["files/a.png", "attachments/x/a.png"]]));
    expect(rewritten).toContain("](attachments/x/a.png)");
    expect(rewritten).toContain("](files/b.png)");
  });
});

describe("buildPlan — attachments on a brain page", () => {
  const REFS = ["files/screenshot-one.png", "files/report.pdf", "files/no-extension-image"];

  const mediaNote = (id: string, title: string, file: string) =>
    parseAs(
      [
        "# yaml-language-server: $schema=schemas/note.schema.json",
        "Object type: Note",
        "Outgoing links:",
        "    - files/screenshot-one.png",
        "    - files/report.pdf",
        "    - files/no-extension-image",
        'Creation date: "2026-03-04T05:06:07Z"',
        `id: ${id}`,
      ],
      [
        `# ${title}   `,
        "",
        "![one](files/screenshot-one.png)   ",
        "[doc](files/report.pdf)   ",
        "![one again](files/screenshot-one.png)   ",
      ],
      file,
    );

  const destOf = (slug: string, name: string) => `attachments/2026/03/${slug}-${name}`;

  it("copies each referenced file and rewrites the body and the frontmatter list", () => {
    const plan = buildPlan(
      [mediaNote(ID_NOTE, "Photo Roundup", "photo-roundup.md")],
      planCtx({ availableAttachments: new Set(REFS) }),
    );
    const page = plan.pages[0];
    expect(page.action).toBe("WRITE");
    expect(page.relPath).toBe("notes/photo-roundup.md");
    expect(page.attachments).toEqual([
      destOf("photo-roundup", "screenshot-one.png"),
      destOf("photo-roundup", "report.pdf"),
      destOf("photo-roundup", "no-extension-image"),
    ]);
    expect(page.refsRewritten).toBe(3);
    // Body: every occurrence rewritten, including the duplicate, and no `files/` left behind.
    expect(page.body).not.toContain("files/");
    expect(page.body).toContain(`![one](${destOf("photo-roundup", "screenshot-one.png")})`);
    expect(page.body.split(`![one again](${destOf("photo-roundup", "screenshot-one.png")})`).length - 1).toBe(1);
    // Frontmatter: one additive list, and the page contract's own keys are unchanged.
    expect(page.frontmatter.attachments).toEqual(page.attachments);
    expect(Object.keys(page.frontmatter)).toEqual([
      "type",
      "title",
      "anytype_id",
      "import_source",
      "imported_at",
      "date",
      "anytype_type",
      "anytype_created_at",
      "attachments",
    ]);
    // One media row per distinct ref, each planned as a copy owned by this page.
    expect(plan.media).toHaveLength(3);
    expect(plan.media.map((m) => m.action)).toEqual(["COPY", "COPY", "COPY"]);
    expect(plan.media.every((m) => m.ownerRelPath === "notes/photo-roundup.md")).toBe(true);
    expect(plan.media.map((m) => m.refKind)).toEqual([
      "body+frontmatter",
      "body+frontmatter",
      "frontmatter",
    ]);
  });

  it("reports a dangling reference instead of inventing a file", () => {
    const plan = buildPlan(
      [mediaNote(ID_NOTE, "Photo Roundup", "photo-roundup.md")],
      planCtx({ availableAttachments: new Set(["files/report.pdf"]) }),
    );
    const missing = plan.media.filter((m) => m.action === "MISSING");
    expect(missing.map((m) => m.ref)).toEqual([
      "files/screenshot-one.png",
      "files/no-extension-image",
    ]);
    expect(missing.every((m) => m.destRelPath !== undefined)).toBe(true);
    expect(missing[0].reason).toContain("reported, not invented");
    // The dangling ref is left exactly as it was and is NOT listed as an attachment of the page.
    expect(plan.pages[0].body).toContain("](files/screenshot-one.png)");
    expect(plan.pages[0].attachments).toEqual([destOf("photo-roundup", "report.pdf")]);
    expect(plan.pages[0].refsRewritten).toBe(1);
  });

  it("does not copy again when the destination file is already on disk (idempotent re-run)", () => {
    const dest = destOf("photo-roundup", "report.pdf");
    const plan = buildPlan(
      [mediaNote(ID_NOTE, "Photo Roundup", "photo-roundup.md")],
      planCtx({
        availableAttachments: new Set(REFS),
        existingPages: new Map([["notes/photo-roundup.md", ID_NOTE]]),
        existingAttachments: new Set([dest]),
      }),
    );
    const page = plan.pages[0];
    expect(page.action).toBe("SKIP-duplicate");
    expect(page.refsRewritten).toBe(0);
    expect(plan.media.filter((m) => m.action === "COPY")).toHaveLength(2);
    expect(plan.media.filter((m) => m.action === "SKIP-present").map((m) => m.target)).toEqual([
      dest,
    ]);
    // The reference still resolves — it was copied by the earlier run.
    expect(page.attachments).toContain(dest);
  });

  it("reports attachments on an object that has no brain page rather than copying them", () => {
    const bookmark = parseAs(
      [
        "# yaml-language-server: $schema=schemas/bookmark.schema.json",
        "Object type: Bookmark",
        "Source: https://example.com/watch?v=x",
        "Picture:",
        "    - files/promo-image.png",
        "Image:",
        "    - files/absent-image.png",
        `id: ${ID_BOOKMARK}`,
      ],
      ["# A Bookmark   ", ""],
      "a-bookmark.md",
    );
    const plan = buildPlan(
      [bookmark],
      planCtx({ availableAttachments: new Set(["files/promo-image.png"]) }),
    );
    expect(plan.captures).toHaveLength(1);
    expect(plan.pages).toHaveLength(0);
    expect(plan.media.map((m) => [m.ref, m.action])).toEqual([
      ["files/promo-image.png", "SKIP-no-destination"],
      ["files/absent-image.png", "MISSING"],
    ]);
    expect(plan.media.every((m) => m.ownerRelPath === null && m.destRelPath === null)).toBe(true);
    expect(plan.media[0].reason).toContain("no brain page");
    expect(plan.media[1].reason).toContain("reported, not invented");
  });

  it("uses the object's modified date for the shard when it has no created date", () => {
    const object = parseAs(
      [
        "Object type: Note",
        "Outgoing links:",
        "    - files/late.png",
        'Last modified: "2025-11-02T00:00:00Z"',
        `id: ${ID_NOTE}`,
      ],
      ["# Late   ", "", "![x](files/late.png)"],
      "late.md",
    );
    const plan = buildPlan([object], planCtx({ availableAttachments: new Set(["files/late.png"]) }));
    expect(plan.pages[0].attachments).toEqual(["attachments/2025/11/late-late.png"]);
  });

  it("adds no attachments key to a page that references nothing", () => {
    const plan = buildPlan(
      [
        parseAs(
          ["Object type: Note", 'Creation date: "2026-03-04"', `id: ${ID_NOTE}`],
          ["# Plain   ", "", "No media here."],
          "plain.md",
        ),
      ],
      planCtx(),
    );
    expect(plan.pages[0].attachments).toEqual([]);
    expect(plan.pages[0].refsRewritten).toBe(0);
    expect(Object.keys(plan.pages[0].frontmatter)).not.toContain("attachments");
    expect(plan.media).toEqual([]);
  });
});

describe("serializePageFile", () => {
  it("produces the exact byte shape FsGitBrainStore.savePage writes", () => {
    const text = serializePageFile({ type: "note", title: "T" }, "Body.   \n\n\n");
    expect(text).toBe('---\ntype: "note"\ntitle: "T"\n---\nBody.\n');
  });

  it("quotes every value so a title with colons, hashes or quotes cannot corrupt the block", () => {
    const title = 'Tricky # Bookmark: With Colons — "quoted" \\ and: more';
    const text = serializePageFile({ type: "note", title }, "b");
    expect(text.split("\n")[0]).toBe("---");
    expect(text.split("\n")[1]).toBe(`type: "note"`);
    expect(text.split("\n")[2]).toBe(`title: ${JSON.stringify(title)}`);
    expect(text.split("\n")[3]).toBe("---");
  });

  it("emits a list value as a block sequence this repo's own reader parses back", () => {
    const text = serializePageFile(
      { type: "note", attachments: ["attachments/2026/03/a.png", "attachments/2026/03/b c.pdf"] },
      "Body.",
    );
    expect(text).toBe(
      [
        "---",
        'type: "note"',
        "attachments:",
        '  - "attachments/2026/03/a.png"',
        '  - "attachments/2026/03/b c.pdf"',
        "---",
        "Body.",
        "",
      ].join("\n"),
    );
    const { frontmatterText } = splitAnytypeFrontmatter(text);
    expect(frontmatterText).not.toBeNull();
    const { frontmatter } = parseAnytypeFrontmatter(frontmatterText as string);
    expect(frontmatter.attachments).toEqual([
      "attachments/2026/03/a.png",
      "attachments/2026/03/b c.pdf",
    ]);
  });

  it("round-trips through this parser's own reader (frontmatter + body)", () => {
    const frontmatter = {
      type: "note",
      title: "My First Note",
      anytype_id: ID_NOTE,
      import_source: "anytype",
      imported_at: IMPORTED_AT.toISOString(),
    };
    const text = serializePageFile(frontmatter, "# not the title\n\nBody line.   ");
    const { frontmatterText, body } = splitAnytypeFrontmatter(text);
    expect(frontmatterText).not.toBeNull();
    const { frontmatter: readBack } = parseAnytypeFrontmatter(frontmatterText as string);
    expect(readBack).toEqual(frontmatter);
    // splitAnytypeFrontmatter is the raw splitter (one trailing newline survives);
    // parseAnytypeExportFile additionally trims the body and lifts a leading H1 into `title`.
    expect(body).toBe("# not the title\n\nBody line.\n");
    expect(body.trimEnd()).toBe("# not the title\n\nBody line.");
    expect(parseAnytypeExportFile(text, "x.md").body).toBe("Body line.");
  });

  it("emits exactly one trailing newline and trims the body's trailing whitespace", () => {
    const text = serializePageFile({ type: "note" }, "Body.  \n\n\n");
    expect(text.endsWith("Body.\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
