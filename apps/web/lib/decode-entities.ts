// SPDX-License-Identifier: MIT
/**
 * Tiny HTML-entity decoder for label strings flowing in from upstream
 * (Plexo synthesis labels, OpenGraph titles, etc.).
 *
 * Covers the named + numeric entities we actually see in the wild —
 * intentionally NOT a full HTML5 parser. If a label slips through with
 * an exotic entity, the worst case is the entity reads literally; the
 * UI never crashes.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(input: string | null | undefined): string {
  if (input == null) return "";
  if (typeof input !== "string") return String(input);
  if (input.indexOf("&") === -1) return input;

  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const lower = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, lower) ? NAMED[lower] : match;
  });
}

/**
 * Walks a JSON-shaped value and decodes entities on every string field.
 * Used at the proxy boundary so the client never sees raw `&amp;`.
 */
export function decodeEntitiesDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return decodeEntities(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => decodeEntitiesDeep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = decodeEntitiesDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
