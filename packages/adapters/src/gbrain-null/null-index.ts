/**
 * NullIndex — the BrainIndex fallback that lets the app run with no GBrain.
 *
 * Scans the brain repo's markdown files and builds a tiny in-memory index from
 * frontmatter (title + type) and body text. Search is substring match; entity
 * lookup and graph are best-effort (nil). This keeps capture + browse alive
 * when GBrain is down or in standalone mode (pre-mortem #6, #9).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { BrainIndex, Slug } from "@nexalog/core";

export class NullIndex implements BrainIndex {
  private cache: Array<{ slug: string; title: string; type: string; text: string }> | null = null;

  constructor(private readonly repoPath: string) {}

  private async entries(): Promise<Array<{ slug: string; title: string; type: string; text: string }>> {
    if (this.cache) return this.cache;
    const out: Array<{ slug: string; title: string; type: string; text: string }> = [];
    const walk = async (dir: string, base: string): Promise<void> => {
      let items: string[];
      try {
        items = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const item of items) {
        if (item.startsWith(".")) continue;
        const abs = path.join(dir, item);
        const stat = await fs.stat(abs).catch(() => null);
        if (!stat) continue;
        if (stat.isDirectory()) {
          await walk(abs, path.join(base, item));
        } else if (item.endsWith(".md")) {
          const raw = await fs.readFile(abs, "utf8");
          const { fm, body } = this.split(raw);
          const slug = path.join(base, item).replace(/\.md$/, "");
          out.push({
            slug,
            title: String(fm.title ?? item.replace(/\.md$/, "")),
            type: String(fm.type ?? "note"),
            text: body,
          });
        }
      }
    };
    await walk(this.repoPath, "");
    this.cache = out;
    return out;
  }

  async search(query: string, opts?: { limit?: number }): Promise<Array<{ slug: string; title: string; snippet: string }>> {
    const q = query.toLowerCase();
    const limit = opts?.limit ?? 20;
    const entries = await this.entries();
    const scored = entries
      .map((e) => {
        const hay = `${e.title} ${e.text}`.toLowerCase();
        const score = hay.includes(q) ? (e.title.toLowerCase().includes(q) ? 2 : 1) : 0;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map(({ e }) => ({
      slug: e.slug,
      title: e.title,
      snippet: snippetAround(e.text, q),
    }));
  }

  async entity(name: string): Promise<{ slug: string; type: string } | null> {
    const entries = await this.entries();
    const hit = entries.find((e) => e.title.toLowerCase() === name.toLowerCase());
    return hit ? { slug: hit.slug, type: hit.type } : null;
  }

  async graphNeighborhood(slug: Slug): Promise<{ nodes: unknown[]; edges: unknown[] }> {
    // No graph in standalone mode; return the seed node only.
    return { nodes: [{ slug: slug.value }], edges: [] };
  }

  async sync(): Promise<void> {
    this.cache = null; // next read rebuilds
  }

  private split(raw: string): { fm: Record<string, unknown>; body: string } {
    if (!raw.startsWith("---\n")) return { fm: {}, body: raw };
    const end = raw.indexOf("\n---", 4);
    if (end === -1) return { fm: {}, body: raw };
    const fmText = raw.slice(4, end);
    const body = raw.slice(end + 4).replace(/^\n/, "");
    const fm: Record<string, unknown> = {};
    for (const line of fmText.split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return { fm, body };
  }
}

function snippetAround(text: string, q: string, radius = 40): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.slice(0, radius);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
