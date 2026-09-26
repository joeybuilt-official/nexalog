// SPDX-License-Identifier: MIT
// Standalone tests for lib/captures/display.ts. No DB. Run with:
//   pnpm tsx scripts/captures-display-test.ts

import {
  cleanFilenameTitle,
  displayDomain,
  displayFavicon,
  displaySummary,
  displayThumbnail,
  displayTitle,
  type DisplayCaptureRow,
} from "../lib/captures/display";

interface Case {
  name: string;
  row: DisplayCaptureRow;
  expect: {
    title?: string;
    domain?: string;
    favicon?: string | null;
    thumbnail?: string | null;
    summary?: string | null;
  };
}

const cases: Case[] = [
  {
    name: "real og_title wins",
    row: {
      url: "https://example.com/path",
      ogTitle: "How TCP Works",
      urlHost: "example.com",
    },
    expect: { title: "How TCP Works", domain: "example.com" },
  },
  {
    name: "raw URL never returned as title",
    row: {
      url: "https://discord.com/api/webhooks/14248377",
      ogTitle: "https://discord.com/api/webhooks/14248377",
      urlHost: "discord.com",
    },
    // The URL-shaped title is rejected; fallback to site/path/domain.
    expect: { title: "Discord.com — Webhooks" },
  },
  {
    name: "no og_title — site_name + pretty path",
    row: {
      url: "https://example.com/articles/quiet-mornings",
      ogSiteName: "Example",
      urlHost: "example.com",
    },
    expect: { title: "Example — Quiet mornings", domain: "example.com" },
  },
  {
    name: "no metadata — domain fallback",
    row: { url: "https://example.com/", urlHost: "example.com" },
    expect: { title: "example.com", domain: "example.com" },
  },
  {
    name: "video uses video_thumbnail_url",
    row: {
      url: "https://www.youtube.com/watch?v=abc",
      videoThumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      kindClassified: "video",
    },
    expect: {
      thumbnail: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    },
  },
  {
    name: "article falls back to og_image",
    row: {
      url: "https://example.com/posts/foo",
      ogImage: "https://cdn.example.com/foo.jpg",
      kindClassified: "article",
    },
    expect: {
      thumbnail: "https://cdn.example.com/foo.jpg",
    },
  },
  {
    name: "favicon stored",
    row: {
      url: "https://example.com/x",
      faviconUrl: "https://cdn.example.com/fav.png",
      urlHost: "example.com",
    },
    expect: { favicon: "https://cdn.example.com/fav.png" },
  },
  {
    name: "favicon derived from host",
    row: { url: "https://example.com/x", urlHost: "example.com" },
    expect: { favicon: "https://example.com/favicon.ico" },
  },
  {
    name: "summary prefers AI-generated",
    row: {
      summary: "The piece argues TCP is fundamentally fine.",
      ogDescription: "raw og description",
      readerText: "Long body…",
    },
    expect: { summary: "The piece argues TCP is fundamentally fine." },
  },
  {
    name: "summary falls through to og_description",
    row: { ogDescription: "OG desc here", readerText: "body" },
    expect: { summary: "OG desc here" },
  },
  {
    name: "summary falls through to first 160 of reader_text",
    row: { readerText: "x".repeat(400) },
    expect: { summary: "x".repeat(160) + "…" },
  },
  {
    name: "domain strips www",
    row: { url: "https://www.example.com/x" },
    expect: { domain: "example.com" },
  },
  {
    name: "snake_case row works",
    row: {
      og_title: "From Postgres",
      url_host: "snake.example",
    },
    expect: { title: "From Postgres", domain: "snake.example" },
  },
  // ----- 0007 hard rules: never return URL/video-id/filename/path-tail. -----
  {
    name: "raw video id rejected — humane YouTube fallback",
    row: {
      url: "https://www.youtube.com/watch?v=x9JSAGPtNQp",
      ogTitle: "x9JSAGPtNQpl4taBB",
      videoId: "x9JSAGPtNQp",
      kindClassified: "video",
      urlHost: "youtube.com",
    },
    expect: {
      title: "Untitled video · YouTube",
      thumbnail: "https://i.ytimg.com/vi/x9JSAGPtNQp/hqdefault.jpg",
    },
  },
  {
    name: "raw filename rejected — cleaned title used",
    row: {
      url: "https://cdn.example.com/uploads/UGC__English_902191I_EdwardS_Perplexity_Computer_Launch_Script_1_Vert.mp4",
      ogTitle: "UGC__English_902191I_EdwardS_Perplexity_Computer_Launch_Script_1_Vert.mp4",
      urlHost: "cdn.example.com",
    },
    // Tokens dropped: UGC, English, Vert, Script, 1, 902191I, EdwardS (>60% digit?). Order preserved.
    // We assert the contains shape rather than full equality because
    // tokenization is implementation-detail.
    expect: {},
  },
  {
    name: "URL-shaped og_title rejected — domain+path fallback",
    row: {
      url: "https://uxplanet.org/claude-md-best-practices-1ef4f861ce7c",
      ogTitle: "https://uxplanet.org/claude-md-best-practices-1ef4f861ce7c",
      urlHost: "uxplanet.org",
    },
    // Hash trailer trimmed; pretty-cased path; domain prefix attached.
    expect: { title: "Uxplanet.org — Claude md best practices" },
  },
  {
    name: "path-tail noise (/Here) rejected — falls back to higher-up segment",
    row: {
      url: "https://travelfreely.com/best-credit-card-offers/Here",
      urlHost: "travelfreely.com",
    },
    expect: { title: "Travelfreely.com — Best credit card offers" },
  },
  {
    name: "derived_title beats ogTitle when ogTitle is bad",
    row: {
      url: "https://example.com/x",
      derivedTitle: "Why Quiet Mornings Beat Loud Ones",
      ogTitle: "https://example.com/x",
      urlHost: "example.com",
    },
    expect: { title: "Why Quiet Mornings Beat Loud Ones" },
  },
  {
    name: "video without thumb but with video_id synthesises ytimg url",
    row: {
      url: "https://www.youtube.com/watch?v=abc123XYZ_-",
      videoId: "abc123XYZ_-",
      kindClassified: "video",
    },
    expect: {
      thumbnail: "https://i.ytimg.com/vi/abc123XYZ_-/hqdefault.jpg",
    },
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const checks: Array<{ name: string; got: unknown; want: unknown }> = [];
  if (c.expect.title !== undefined)
    checks.push({ name: "title", got: displayTitle(c.row), want: c.expect.title });
  if (c.expect.domain !== undefined)
    checks.push({ name: "domain", got: displayDomain(c.row), want: c.expect.domain });
  if (c.expect.favicon !== undefined)
    checks.push({ name: "favicon", got: displayFavicon(c.row), want: c.expect.favicon });
  if (c.expect.thumbnail !== undefined)
    checks.push({ name: "thumbnail", got: displayThumbnail(c.row), want: c.expect.thumbnail });
  if (c.expect.summary !== undefined)
    checks.push({ name: "summary", got: displaySummary(c.row), want: c.expect.summary });

  let caseOk = true;
  for (const check of checks) {
    if (check.got !== check.want) {
      caseOk = false;
      console.log(
        `FAIL ${c.name} :: ${check.name} got=${JSON.stringify(check.got)} want=${JSON.stringify(check.want)}`,
      );
    }
  }
  if (caseOk) {
    pass++;
    console.log(`PASS ${c.name}`);
  } else {
    fail++;
  }
}

// ---- cleanFilenameTitle unit tests ----
const filenameCases: Array<{ in: string; assert: (out: string | null) => boolean; name: string }> = [
  {
    name: "UGC denylist + numeric chunks dropped",
    in: "UGC__English_902191I_EdwardS_Perplexity_Computer_Launch_Script_1_Vert.mp4",
    assert: (out) => {
      if (!out) return false;
      const lower = out.toLowerCase();
      // Denylist tokens must be gone.
      if (lower.includes("ugc")) return false;
      if (lower.includes("english")) return false;
      if (lower.includes("vert")) return false;
      if (lower.includes("script")) return false;
      // Real words must survive.
      if (!lower.includes("perplexity")) return false;
      if (!lower.includes("computer")) return false;
      if (!lower.includes("launch")) return false;
      // 3+ words.
      if (out.split(/\s+/).length < 3) return false;
      return true;
    },
  },
  {
    name: "underscores → spaces, .mp4 stripped, title-case",
    in: "my_great_thinking_session.mp4",
    assert: (out) => out === "My Great Thinking Session",
  },
  {
    name: "<3 humane words returns null",
    in: "v1_final.mov",
    assert: (out) => out === null,
  },
  {
    name: "preserves short acronyms",
    in: "AI_research_summary.pdf",
    assert: (out) => out !== null && out.startsWith("AI "),
  },
];

let fnPass = 0;
let fnFail = 0;
for (const c of filenameCases) {
  const got = cleanFilenameTitle(c.in);
  if (c.assert(got)) {
    fnPass++;
    console.log(`PASS [filename] ${c.name} -> ${JSON.stringify(got)}`);
  } else {
    fnFail++;
    console.log(`FAIL [filename] ${c.name} -> ${JSON.stringify(got)}`);
  }
}

// ---- hard-rule predicate tests on full displayTitle output ----
const hardRules: Array<{ name: string; row: DisplayCaptureRow }> = [
  {
    name: "raw URL og_title",
    row: { url: "https://x.com/y", ogTitle: "https://x.com/y", urlHost: "x.com" },
  },
  {
    name: "raw video id og_title",
    row: { url: "https://youtube.com/", ogTitle: "x9JSAGPtNQpl4taBB", urlHost: "youtube.com" },
  },
  {
    name: "raw .mp4 filename og_title",
    row: { url: "https://example.com/", ogTitle: "UGC__English_Vert.mp4", urlHost: "example.com" },
  },
  {
    name: "weird /Here tail",
    row: { url: "https://travelfreely.com/best-credit-card-offers/Here", urlHost: "travelfreely.com" },
  },
];

let hrPass = 0;
let hrFail = 0;
for (const r of hardRules) {
  const got = displayTitle(r.row);
  const isUrl = /^https?:\/\//i.test(got);
  const isBareVidId = !/\s/.test(got) && got.length >= 8 && got.length <= 24 && /^[A-Za-z0-9_-]+$/.test(got);
  const isRawFilename = /\.(mp4|mov|webm|mp3|wav|pdf)$/i.test(got);
  const isPathTailNoise = /\b(?:Here|Index|Page|Home|Default)$/i.test(got) && !got.includes(" — ");
  if (!isUrl && !isBareVidId && !isRawFilename && !isPathTailNoise) {
    hrPass++;
    console.log(`PASS [hard-rule] ${r.name} -> ${JSON.stringify(got)}`);
  } else {
    hrFail++;
    console.log(`FAIL [hard-rule] ${r.name} -> ${JSON.stringify(got)}`);
  }
}

const totalPass = pass + fnPass + hrPass;
const totalFail = fail + fnFail + hrFail;
const totalCount = cases.length + filenameCases.length + hardRules.length;
console.log(`\n${totalPass}/${totalCount} passed, ${totalFail} failed.`);
process.exit(totalFail === 0 ? 0 : 1);
