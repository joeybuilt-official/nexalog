// Minimal slugifier — kept inline so the export package has no runtime deps
// beyond `archiver`. Conservative: ASCII only, lowercase, hyphens.

export function slugify(s: string, max = 60): string {
  const base = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "untitled";
  return base.length > max ? base.slice(0, max).replace(/-+$/, "") : base;
}

export function userIdShort(userId: string): string {
  // Strip non-alphanum so weird auth IDs still produce a clean filename.
  const clean = userId.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 8) || "user";
}

export function exportFilename(userId: string, now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `nexalog-export-${userIdShort(userId)}-${y}${m}${d}.zip`;
}
