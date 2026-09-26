// SPDX-License-Identifier: MIT
/**
 * Server-side placeholder card generator for articles without an
 * `og:image`. Produces a SVG → data URL on a tasteful neutral gradient
 * pulled from the existing design tokens (no orange / no shouty colors).
 *
 * Persisted into `og_image_url` so display.ts uses it transparently in
 * card grids — no client-side branching needed.
 *
 * Inputs are deliberately small (domain + optional favicon URL) so the
 * data URL stays under ~6KB even for unusual domains.
 */

const WIDTH = 1200;
const HEIGHT = 630;

// Neutral gradient stops that match the dark/light card surfaces. Picked to
// land in the same zone as `bg-card` + `bg-muted` so cards never look out
// of place on the bookmarks grid.
const GRADIENT_FROM = "#1f2024";
const GRADIENT_TO = "#101114";
const TEXT_COLOR = "#e7e6e2";
const ACCENT_COLOR = "#a89a82";

/**
 * Build a SVG card and return it as a data URL. Pure — no fetches.
 *
 * If `faviconUrl` is provided, it's referenced via an `<image href>` tag.
 * SVGs allow remote hrefs but most renderers fall back to nothing on
 * fetch failure, which is fine — the domain text still renders.
 */
export function buildPlaceholderCardDataUrl(opts: {
  domain: string;
  title?: string | null;
  faviconUrl?: string | null;
}): string {
  const domain = (opts.domain || "").trim().slice(0, 60) || "unknown";
  const title = (opts.title || "").trim().slice(0, 90);
  const favicon = opts.faviconUrl?.trim() || null;

  const safeDomain = escapeXml(domain);
  const safeTitle = title ? escapeXml(title) : "";
  const safeFavicon = favicon ? escapeXml(favicon) : null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${GRADIENT_FROM}"/>
      <stop offset="100%" stop-color="${GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="48" y="48" width="${WIDTH - 96}" height="${HEIGHT - 96}" rx="24" fill="none" stroke="${ACCENT_COLOR}" stroke-opacity="0.18" stroke-width="1.5"/>
  ${safeFavicon ? `<image href="${safeFavicon}" x="120" y="120" width="64" height="64"/>` : ""}
  <text x="120" y="${safeFavicon ? 240 : 200}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="36" font-weight="600" fill="${ACCENT_COLOR}" letter-spacing="0.5">${safeDomain}</text>
  ${safeTitle ? `<text x="120" y="${safeFavicon ? 320 : 280}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="56" font-weight="700" fill="${TEXT_COLOR}">${wrapText(safeTitle, 28)}</text>` : ""}
</svg>`.replace(/\s+\n/g, "\n");

  // Encode without base64 to keep URLs short; just URI-escape.
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml,${encoded}`;
}

/** Wrap a single line of title text into <tspan> rows so it doesn't
 *  overflow the card. Crude but no font measuring needed. */
function wrapText(text: string, charsPerLine: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > charsPerLine) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current + " " + w).trim();
    }
  }
  if (current) lines.push(current);
  // Cap at 3 lines for the card layout.
  const capped = lines.slice(0, 3);
  return capped
    .map((l, i) => `<tspan x="120" dy="${i === 0 ? 0 : 64}">${l}</tspan>`)
    .join("");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
