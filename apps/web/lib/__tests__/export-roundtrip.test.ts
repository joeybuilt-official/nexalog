import { describe, it, expect } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildExportArchive } from "@/lib/export/build-archive";
import { parseNoteFile, buildFrontmatter } from "@/lib/export/frontmatter";
import { exportFilename, slugify, userIdShort } from "@/lib/export/slug";
import { buildCapturesCsv, CAPTURE_EXPORT_COLUMNS } from "@/lib/export/captures-csv";
import type { ExportBundle } from "@/lib/export/types";

// ZIP local file header parser — just enough to round-trip names + content
// for STORE (method 0) and DEFLATE (method 8) entries. ZIP spec APPNOTE 4.3.7.
function readZipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) break; // hit central directory
    const generalFlag = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    let compSize = buf.readUInt32LE(off + 18);
    let uncompSize = buf.readUInt32LE(off + 22);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString("utf8");
    const dataStart = off + 30 + nameLen + extraLen;

    // archiver writes streamed entries with general-purpose bit 3 set, so
    // sizes are zero in the local header and live in a trailing data
    // descriptor. Scan to the next signature (PK\x07\x08 descriptor or PK\x03\x04
    // next entry or PK\x01\x02 central dir) to bound the compressed payload.
    if ((generalFlag & 0x08) !== 0 || compSize === 0) {
      let scan = dataStart;
      while (scan + 4 <= buf.length) {
        const s = buf.readUInt32LE(scan);
        if (s === 0x08074b50) {
          compSize = buf.readUInt32LE(scan + 8);
          uncompSize = buf.readUInt32LE(scan + 12);
          break;
        }
        if (s === 0x04034b50 || s === 0x02014b50) {
          compSize = scan - dataStart;
          break;
        }
        scan++;
      }
    }

    const payload = buf.slice(dataStart, dataStart + compSize);
    const data = method === 0 ? payload : inflateRawSync(payload);
    if (uncompSize > 0 && data.length !== uncompSize) {
      // sanity check the descriptor read
    }
    out.push({ name, data });

    // advance past payload + optional 16-byte data descriptor
    let next = dataStart + compSize;
    if ((generalFlag & 0x08) !== 0 && next + 4 <= buf.length) {
      const maybeSig = buf.readUInt32LE(next);
      if (maybeSig === 0x08074b50) next += 16;
    }
    off = next;
  }
  return out;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

describe("export filename + slug", () => {
  it("stamps userIdShort + YYYYMMDD", () => {
    const f = exportFilename("user-abc-123-zzzz", new Date(Date.UTC(2026, 5, 27)));
    expect(f).toBe("nexalog-export-userabc1-20260627.zip");
  });
  it("slugify keeps ascii hyphens, drops the rest", () => {
    expect(slugify("Hello, World! — 1")).toBe("hello-world-1");
    expect(slugify("")).toBe("untitled");
  });
  it("userIdShort copes with weird ids", () => {
    expect(userIdShort("__x__")).toBe("x");
    expect(userIdShort("")).toBe("user");
  });
});

describe("frontmatter round-trip", () => {
  it("emits a Date as ISO and survives parse", () => {
    const fm = buildFrontmatter({
      title: "Hello: World",
      id: "abc",
      tags: ["one", "two"],
      created: new Date("2026-06-27T10:00:00.000Z"),
    });
    const { frontmatter } = parseNoteFile(`${fm}\n\nbody here`);
    expect(frontmatter.title).toBe("Hello: World");
    expect(frontmatter.id).toBe("abc");
    expect(frontmatter.tags).toEqual(["one", "two"]);
    expect(frontmatter.created).toBe("2026-06-27T10:00:00.000Z");
  });
});

describe("captures CSV", () => {
  it("includes all canonical columns + escapes commas + nests JSON for objects", () => {
    const csv = buildCapturesCsv([
      {
        id: "cap-1",
        url: "https://x.test/a,b",
        metadata: { foo: 1 },
        ogTitle: 'has "quote"',
      },
    ]);
    const [header, row] = csv.trim().split("\n");
    expect(header.split(",")).toEqual([...CAPTURE_EXPORT_COLUMNS]);
    expect(row).toContain(`"https://x.test/a,b"`);
    expect(row).toContain(`"{""foo"":1}"`);
    expect(row).toContain(`"has ""quote"""`);
  });
});

describe("buildExportArchive end-to-end", () => {
  it("round-trips a tiny fixture: ZIP contains expected paths, note parses back identically", async () => {
    const bundle: ExportBundle = {
      userId: "user-roundtrip-1",
      exportedAt: new Date("2026-06-27T12:00:00.000Z"),
      workspaces: [
        { id: "ws-1", slug: "personal", name: "Personal" },
      ],
      notes: [
        {
          id: "note-1",
          workspaceId: "ws-1",
          title: "Hello: World",
          content: "<p>body content here</p>",
          kind: "note",
          lifecycleState: "active",
          tags: ["one", "two"],
          createdAt: new Date("2026-06-26T09:00:00.000Z"),
          updatedAt: new Date("2026-06-27T09:00:00.000Z"),
        },
      ],
      captures: [
        { id: "cap-1", url: "https://x.test/", kind: "url" },
      ],
      noteLinks: [
        {
          sourceNoteId: "note-1",
          targetNoteId: "note-2",
          kind: "related",
          strength: 0.5,
          createdAt: new Date("2026-06-27T08:00:00.000Z"),
        },
      ],
      journal: [
        {
          id: "j-1",
          workspaceId: "ws-1",
          entryDate: "2026-06-27",
          body: "felt good",
          mood: 4,
          energy: 3,
          weather: null,
          voiceSourceId: null,
        },
      ],
    };

    const stream = buildExportArchive(bundle);
    const buf = await streamToBuffer(stream);
    expect(buf.length).toBeGreaterThan(0);

    const entries = readZipEntries(buf);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("notes/personal/note-1-hello-world.md");
    expect(names).toContain("journal/2026-06-27.md");
    expect(names).toContain("captures.csv");
    expect(names).toContain("note_links.json");
    expect(names).toContain("manifest.json");
    expect(names).toContain("README.md");

    const noteEntry = entries.find((e) => e.name === "notes/personal/note-1-hello-world.md")!;
    const { frontmatter, body } = parseNoteFile(noteEntry.data.toString("utf8"));
    expect(frontmatter.title).toBe("Hello: World");
    expect(frontmatter.id).toBe("note-1");
    expect(frontmatter.tags).toEqual(["one", "two"]);
    expect(body).toBe("<p>body content here</p>");

    const manifest = JSON.parse(
      entries.find((e) => e.name === "manifest.json")!.data.toString("utf8"),
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.counts).toEqual({
      notes: 1,
      captures: 1,
      links: 1,
      journal: 1,
      workspaces: 1,
    });
    expect(manifest.userId).toBe("user-roundtrip-1");
  });
});
