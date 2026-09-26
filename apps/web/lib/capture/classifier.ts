// Phase 11 classifier — pure URL/metadata analysis
// Order: video > social > article > reference > homepage > other
// Homepage detection runs AFTER content classifiers so a known-content URL
// (e.g. youtube.com/watch?v=...) never gets demoted to homepage.

export type ClassifiedKind =
  | "video"
  | "article"
  | "reference"
  | "social"
  | "homepage"
  | "other";

export interface ClassifyInput {
  url: string;
  ogType?: string | null;
}

export interface ClassifyResult {
  kind: ClassifiedKind;
  host: string;
  path: string;
}

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "twitch.tv",
  "www.twitch.tv",
  "tiktok.com",
  "www.tiktok.com",
  "rumble.com",
]);

const SOCIAL_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "linkedin.com",
  "www.linkedin.com",
  "threads.net",
  "www.threads.net",
  "bsky.app",
  "mastodon.social",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
]);

const REFERENCE_HOST_PATTERNS: RegExp[] = [
  /^docs\./,
  /\.docs\./,
  /^developer\./,
  /^developers\./,
  /^api\./,
  /^reference\./,
  /^learn\.microsoft\.com$/,
  /^developer\.mozilla\.org$/,
  /^docs\.python\.org$/,
  /^en\.wikipedia\.org$/,
  /^wikipedia\.org$/,
  /^stackoverflow\.com$/,
  /^github\.com$/, // for /owner/repo/blob paths — root is homepage handled later
];

const ARTICLE_HOST_PATTERNS: RegExp[] = [
  /^medium\.com$/,
  /\.medium\.com$/,
  /^substack\.com$/,
  /\.substack\.com$/,
  /^dev\.to$/,
  /^hashnode\./,
  /^news\.ycombinator\.com$/,
];

const ARTICLE_PATH_PATTERNS: RegExp[] = [
  /\/blog\//i,
  /\/posts?\//i,
  /\/articles?\//i,
  /\/news\//i,
  /\/\d{4}\/\d{1,2}\/\d{1,2}\//, // /2024/03/15/ date paths
];

// Marketing-only query params (utm_* and similar) — treat as "no real query".
const MARKETING_PARAM = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function classifyUrl(input: ClassifyInput): ClassifyResult {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { kind: "other", host: "", path: "" };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || "/";
  const search = parsed.search;
  const ogType = (input.ogType ?? "").toLowerCase();

  // Video — known video host with an explicit content path. Bare root
  // (e.g. youtube.com/) is NOT video; it falls through to homepage.
  const isContentVideo =
    host === "youtu.be"
      ? path.length > 1 // youtu.be/<id>
      : VIDEO_HOSTS.has(host) &&
        (path.startsWith("/watch") ||
          path.startsWith("/shorts/") ||
          path.startsWith("/v/") ||
          path.startsWith("/embed/") ||
          path.startsWith("/videos/") ||
          /^\/@[^/]+\/video/.test(path) || // tiktok @user/video/...
          /^\/videos?\/\d+/.test(path));    // vimeo /<id>
  if (
    ogType === "video" ||
    ogType === "video.movie" ||
    ogType === "video.episode" ||
    ogType === "video.other" ||
    isContentVideo
  ) {
    return { kind: "video", host, path };
  }

  // Social — host match is enough; root paths still mean "social brand homepage"
  // but we treat any social-host hit as social so x.com/foo is social, not homepage.
  if (SOCIAL_HOSTS.has(host)) {
    // Bare root x.com/ stays homepage (people do save x.com itself); real handles/posts go social.
    if (path === "/" || path === "") {
      // fall through to homepage detection
    } else {
      return { kind: "social", host, path };
    }
  }

  // Article — explicit og:type=article, OR known article host, OR path matches blog patterns.
  if (ogType === "article") {
    return { kind: "article", host, path };
  }
  if (ARTICLE_HOST_PATTERNS.some((re) => re.test(host))) {
    if (path !== "/" && path !== "") return { kind: "article", host, path };
  }
  if (ARTICLE_PATH_PATTERNS.some((re) => re.test(path))) {
    return { kind: "article", host, path };
  }

  // Reference — docs.*, developer.*, api.*, MDN, Wikipedia, etc., when path is real.
  if (REFERENCE_HOST_PATTERNS.some((re) => re.test(host))) {
    if (path !== "/" && path !== "") return { kind: "reference", host, path };
  }

  // Homepage — runs AFTER content classifiers.
  // URL path is empty / "/" / single short slug (≤8 chars), no query OR only marketing query.
  const isShallowPath =
    path === "/" ||
    path === "" ||
    /^\/[a-z0-9-]{1,8}\/?$/i.test(path); // e.g. /about, /products
  const queryEffectivelyEmpty = isQueryMarketingOnly(search);
  if (isShallowPath && queryEffectivelyEmpty) {
    return { kind: "homepage", host, path };
  }

  return { kind: "other", host, path };
}

function isQueryMarketingOnly(search: string): boolean {
  if (!search || search === "?") return true;
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!MARKETING_PARAM.test(key)) return false;
  }
  return true;
}
