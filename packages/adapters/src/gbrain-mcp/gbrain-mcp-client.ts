/**
 * GBrainMcpClient — the HTTP adapter for GBrain's MCP server.
 *
 * Speaks MCP JSON-RPC 2.0 over HTTPS with an SSE transport, exactly the shape
 * the live server returns (`event: message` + `data: {jsonrpc result}` lines).
 * Implements the read-only `GBrainClient` port from `@nexalog/core`; Nexalog
 * makes zero LLM calls of its own — it only calls GBrain's tools.
 *
 * Zero new runtime deps: uses Node's global `fetch` (Node >= 18) and hand-rolled
 * JSON. No MCP SDK, no zod. Dependencies point inward (core only).
 *
 * Transport notes (verified against the live server, 2026-09-25):
 *  - REQUIRED header `Accept: application/json, text/event-stream`.
 *  - Auth is `Authorization: Bearer <MCP_GBRAIN_API_KEY>`.
 *  - The response body is a text/event-stream: one or more `event: message`
 *    lines each followed by a `data: {…}` JSON line. We parse the first data
 *    payload (single-shot request → single response).
 *  - `tools/call` result is `{ content: [{ type: "text", text: "…JSON…" }],
 *    _meta: {…} }`. The text field is a JSON string we re-parse into plain
 *    records for the port.
 */

import type {
  GBrainClient,
  GBrainSearchHit,
  GBrainPage,
  GBrainPageSummary,
  GBrainListPagesOptions,
  GBrainLink,
  GBrainEntity,
} from "@nexalog/core";

export interface GBrainMcpClientOptions {
  /** Base URL of the MCP server, e.g. https://gbrain.example.com/mcp */
  url: string;
  /** Bearer token (MCP_GBRAIN_API_KEY). */
  apiKey: string;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** Error thrown on transport/auth/HTTP failure — callers catch and degrade. */
export class GBrainMcpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GBrainMcpError";
  }
}

interface McpTextContent {
  type: string;
  text?: string;
}

interface McpResult {
  content?: McpTextContent[];
  [key: string]: unknown;
}

type Json = Record<string, unknown>;

export class GBrainMcpClient implements GBrainClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private id = 0;

  constructor(opts: GBrainMcpClientOptions) {
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async search(
    query: string,
    opts?: { limit?: number; types?: string[] },
  ): Promise<GBrainSearchHit[]> {
    return this.searchImpl("search", query, opts);
  }

  async query(
    query: string,
    opts?: { limit?: number; types?: string[] },
  ): Promise<GBrainSearchHit[]> {
    return this.searchImpl("query", query, opts);
  }

  async getPage(slug: string): Promise<GBrainPage | null> {
    const text = await this.call("get_page", { slug });
    const parsed = this.parseTextAny(text);
    const p = parsed[0];
    if (typeof p !== "object" || p === null) return null;
    const rec = p as Record<string, unknown>;
    // The server may also return the page nested under a `page` key.
    const inner =
      typeof rec.page === "object" && rec.page !== null
        ? (rec.page as Record<string, unknown>)
        : rec;
    if (!str(inner.slug) && !str(inner.title) && !str(inner.content)) return null;
    return {
      slug: str(inner.slug) ?? slug,
      title: str(inner.title) ?? "",
      type: str(inner.type) ?? "",
      body: str(inner.content) ?? str(inner.compiled_truth) ?? str(inner.body) ?? "",
    };
  }

  async getBacklinks(slug: string): Promise<GBrainLink[]> {
    const text = await this.call("get_backlinks", { slug });
    const arr = this.parseTextArray(text);
    return arr.map((item) => this.toLink(item, null)).filter((l): l is GBrainLink => l !== null);
  }

  /**
   * List the brain's pages (identity only). VERIFIED against the live server:
   * `list_pages` returns `{slug, source_id, type, title, updated_at}` rows and
   * accepts `limit` / `offset` / `type` / `sort`.
   */
  async listPages(opts?: GBrainListPagesOptions): Promise<GBrainPageSummary[]> {
    const args: Record<string, unknown> = {};
    if (opts?.limit !== undefined) args.limit = opts.limit;
    if (opts?.offset !== undefined) args.offset = opts.offset;
    if (opts?.type) args.type = opts.type;
    if (opts?.sort) args.sort = opts.sort;
    const text = await this.call("list_pages", args);
    const arr = this.parseTextArray(text);
    const out: GBrainPageSummary[] = [];
    for (const item of arr) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as Record<string, unknown>;
      const slug = str(r.slug);
      if (!slug) continue; // a row with no slug cannot be read or linked to
      out.push({
        slug,
        title: str(r.title) ?? "",
        type: str(r.type) ?? "",
        sourceId: str(r.source_id),
        updatedAt: str(r.updated_at),
      });
    }
    return out;
  }

  async traverseGraph(
    slug: string,
    opts?: { depth?: number; direction?: "in" | "out" | "both" },
  ): Promise<GBrainLink[]> {
    const args: Record<string, unknown> = { slug };
    if (opts?.depth !== undefined) args.depth = opts.depth;
    if (opts?.direction !== undefined) args.direction = opts.direction;
    const text = await this.call("traverse_graph", args);
    const arr = this.parseTextArray(text);
    return arr.map((item) => this.toLink(item, null)).filter((l): l is GBrainLink => l !== null);
  }

  async entity(name: string): Promise<GBrainEntity> {
    const text = await this.call("entity", { name });
    const parsed = this.parseTextAny(text);
    const rec = parsed[0] as Record<string, unknown> | undefined;
    const found = rec ? Boolean(rec.found) : false;
    // The live shape nests the identity under `card.entity`:
    //   { found: true, card: { entity: { slug, title, type } } }
    const card =
      rec && typeof rec.card === "object" && rec.card !== null
        ? (rec.card as Record<string, unknown>)
        : null;
    const inner =
      card && typeof card.entity === "object" && card.entity !== null
        ? (card.entity as Record<string, unknown>)
        : rec;
    return {
      found,
      slug: found ? str(inner?.slug) ?? null : null,
      type: found ? str(inner?.type) ?? null : null,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async searchImpl(
    tool: "search" | "query",
    query: string,
    opts?: { limit?: number; types?: string[] },
  ): Promise<GBrainSearchHit[]> {
    const args: Record<string, unknown> = { query };
    if (opts?.limit !== undefined) args.limit = opts.limit;
    if (opts?.types && opts.types.length) args.types = opts.types;
    const text = await this.call(tool, args);
    const arr = this.parseTextArray(text);
    const out: GBrainSearchHit[] = [];
    for (const item of arr) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as Record<string, unknown>;
      out.push({
        slug: str(r.slug) ?? "",
        title: str(r.title) ?? "",
        type: str(r.type) ?? "",
        chunkText: str(r.chunk_text) ?? "",
        score: typeof r.score === "number" ? r.score : null,
        sourceId: str(r.source_id),
        effectiveDate: str(r.effective_date),
        // The semantic component, passed through as-is. `score` above is RRF-fused
        // (keyword hits + backlink boost + graph adjacency), so a caller that needs
        // to claim semantic closeness — the plan-impact reconciler — must read this
        // field; null when the server did not report one, never a made-up default.
        cosine: typeof r.cosine === "number" && Number.isFinite(r.cosine) ? r.cosine : null,
      });
    }
    return out;
  }

  /** Map a traverse_graph / get_backlinks record to a GBrainLink, or null if malformed. */
  private toLink(item: unknown, _depthOverride: number | null): GBrainLink | null {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    const from = str(r.from_slug);
    const to = str(r.to_slug);
    if (!from && !to) return null;
    return {
      fromSlug: from ?? "",
      toSlug: to ?? "",
      linkType: str(r.link_type) ?? "",
      context: str(r.context),
      depth: typeof r.depth === "number" ? r.depth : null,
    };
  }

  /** Parse `content[0].text` (a JSON string) into an array of plain records. */
  private parseTextArray(text: string | null): unknown[] {
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Parse `content[0].text` into a record list, tolerating BOTH a JSON array
   * (search/links) and a single JSON object (get_page / entity). Also unwraps
   * a top-level `result`/`page`/`entity` envelope when present.
   */
  private parseTextAny(text: string | null): unknown[] {
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        for (const key of ["result", "page", "entity", "data"]) {
          const v = rec[key];
          if (Array.isArray(v)) return v;
          if (v && typeof v === "object") return [v];
        }
        return [rec];
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * One tools/call round-trip. Returns the `text` field of the first text
   * content block, or the stringified result when content is absent.
   */
  private async call(tool: string, args: Record<string, unknown>): Promise<string | null> {
    const payload = {
      jsonrpc: "2.0",
      id: ++this.id,
      method: "tools/call",
      params: { name: tool, arguments: args },
    };

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new GBrainMcpError(`GBrain MCP request failed (${tool}): ${String(e)}`, null, e);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GBrainMcpError(
        `GBrain MCP HTTP ${res.status} (${tool}): ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const raw = await res.text();
    const result = this.parseSseResult(raw);
    if (!result) return null;

    if (result.content && result.content.length > 0) {
      const block = result.content.find((c) => c.type === "text");
      if (block && typeof block.text === "string") return block.text;
    }
    // Some tools return a non-content result — stringify as a fallback.
    return JSON.stringify(result);
  }

  /** Parse the SSE body, returning the JSON-RPC `result` of the first data line. */
  private parseSseResult(raw: string): McpResult | null {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      let msg: Json;
      try {
        msg = JSON.parse(data) as Json;
      } catch {
        continue;
      }
      if (msg.error) {
        const err = msg.error as Record<string, unknown>;
        throw new GBrainMcpError(
          `GBrain MCP tool error: ${String(err.message ?? JSON.stringify(err))}`,
          null,
        );
      }
      if (msg.result && typeof msg.result === "object") {
        return msg.result as McpResult;
      }
    }
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : v === null || v === undefined ? null : String(v);
}
