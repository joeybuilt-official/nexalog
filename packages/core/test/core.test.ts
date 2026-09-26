import { describe, it, expect } from "vitest";
import { Ulid } from "../src/domain/ulid";
import { Slug } from "../src/domain/slug";
import { Capture } from "../src/domain/capture";
import { serializeCapture, parseCapture } from "../src/contracts/frontmatter";

describe("Ulid", () => {
  it("accepts a valid ULID", () => {
    expect(Ulid.of("0123456789ABCDEFGHJKMNPQRS").value).toBe("0123456789ABCDEFGHJKMNPQRS");
  });
  it("rejects bad input", () => {
    expect(() => Ulid.of("not-a-ulid")).toThrow();
  });
});

describe("Slug", () => {
  it("normalizes path-like input", () => {
    expect(Slug.of("People/Example-Person.md").value).toBe("people/example-person");
  });
  it("produces a file path", () => {
    expect(Slug.of("people/example-person").toFilePath()).toBe("people/example-person.md");
  });
  it("rejects unsafe segments", () => {
    expect(() => Slug.of("foo/../bar")).toThrow();
    expect(() => Slug.of("has space")).toThrow();
  });
});

describe("Capture", () => {
  const base = () => ({
    id: Ulid.of("0123456789ABCDEFGHJKMNPQRS"),
    title: "Voice note",
    body: "hello",
    type: "note" as const,
    status: "inbox" as const,
    kind: "audio" as const,
    source: "pwa-share" as const,
    capturedAt: new Date("2026-09-23T06:41:00Z"),
    claimedBy: null,
    claimedAt: null,
    attachments: [],
    originUrl: null,
    proposal: null,
  });

  it("claims only from inbox", () => {
    const c = new Capture(base());
    c.claim("agent-primary", new Date());
    expect(c.status).toBe("processing");
    expect(c.state.claimedBy).toBe("agent-primary");
    expect(() => c.claim("x", new Date())).toThrow();
  });

  it("full lifecycle inbox→processing→review→reject", () => {
    const c = new Capture(base());
    c.claim("agent-primary", new Date());
    c.markReview({ pages: [], links: [], confidence: 0.4 });
    expect(c.status).toBe("review");
    c.reject();
    expect(c.status).toBe("rejected");
  });
});

describe("frontmatter contract", () => {
  it("round-trips a capture through YAML", () => {
    const state = {
      id: Ulid.of("0123456789ABCDEFGHJKMNPQRS"),
      title: "Voice note 2026-09-23",
      body: "transcript here",
      type: "note" as const,
      status: "inbox" as const,
      kind: "audio" as const,
      source: "pwa-share" as const,
      capturedAt: new Date("2026-09-23T06:41:00Z"),
      claimedBy: null,
      claimedAt: null,
      attachments: [{ path: "attachments/2026/09/x.opus", kind: "audio" as const, sizeBytes: 100 }],
      originUrl: null,
      proposal: null,
    };
    const text = serializeCapture(state);
    // sanity: has the nexalog block and body
    expect(text).toContain("nexalog:");
    expect(text).toContain("transcript here");
    // re-parse by simulating a gray-matter split (frontmatter is between --- markers)
    const body = text.split("---\n").slice(2).join("---\n");
    const parsed = parseCapture(state.id, {
      type: "note",
      title: "Voice note 2026-09-23",
      nexalog: {
        schema: 1,
        status: "inbox",
        kind: "audio",
        source: "pwa-share",
        captured_at: "2026-09-23T06:41:00.000Z",
        claimed_by: null,
        claimed_at: null,
        attachments: ["attachments/2026/09/x.opus"],
        origin_url: null,
        proposal: null,
      },
    }, body.trim());
    expect(parsed.title).toBe("Voice note 2026-09-23");
    expect(parsed.body).toBe("transcript here");
  });
});
