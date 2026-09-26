// Minimal YAML frontmatter serializer — Obsidian-compatible subset.
// We deliberately roll our own (no yaml dep) because the value space is tight:
// strings, numbers, ISO dates, string-array tags. Anything richer goes in the
// JSON sidecars.

function escapeYamlString(s: string): string {
  if (s === "") return '""';
  // Quote if it contains chars that confuse the unquoted YAML scalar parser.
  if (/[:#\n"'\\\[\]{},&*?|<>=!%@`]/.test(s) || /^[\s-]/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

type YamlPrimitive = string | number | boolean | Date | null | undefined;
type YamlValue = YamlPrimitive | string[];

export function buildFrontmatter(fields: Record<string, YamlValue>): string {
  const lines: string[] = ["---"];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of raw) lines.push(`  - ${escapeYamlString(item)}`);
      continue;
    }
    if (raw instanceof Date) {
      lines.push(`${key}: ${raw.toISOString()}`);
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      lines.push(`${key}: ${raw}`);
      continue;
    }
    lines.push(`${key}: ${escapeYamlString(String(raw))}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export interface ParsedNoteFile {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

// Inverse: parse what buildFrontmatter writes (good enough for the round-trip
// test; not a general YAML parser).
export function parseNoteFile(text: string): ParsedNoteFile {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontmatter: {}, body: text };
  }
  const fm: Record<string, string | string[]> = {};
  let i = 1;
  let currentArrayKey: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---") {
      i++;
      break;
    }
    const arrayItem = line.match(/^\s+-\s+(.*)$/);
    if (arrayItem && currentArrayKey) {
      (fm[currentArrayKey] as string[]).push(unquote(arrayItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];
    if (val === "") {
      fm[key] = [];
      currentArrayKey = key;
    } else {
      fm[key] = unquote(val);
      currentArrayKey = null;
    }
  }
  // Skip the single blank line after closing ---.
  if (lines[i] === "") i++;
  const body = lines.slice(i).join("\n");
  return { frontmatter: fm, body };
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}
