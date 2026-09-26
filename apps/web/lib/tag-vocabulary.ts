// SPDX-License-Identifier: MIT
/**
 * Controlled-vocabulary bookmark tagging — single source of truth.
 *
 * Bookmark tags were freeform AI output, producing synonym sprawl ("AI" vs
 * "Artificial Intelligence" vs "Machine Learning") and random colors. This
 * module pins an ordered, fixed-color vocabulary and the rules that map
 * existing themes / freeform tags onto it.
 *
 * Resolution order (see resolveCanonicalTags):
 *   1. THEME_TAG_MAP[themeLabel]   — anchor to the themes-forest cluster label
 *   2. SYNONYM_MAP hits            — collapse existing freeform tag names
 *   3. (caller falls back to LLM constrained to CANONICAL_TAGS if [] returned)
 */

export interface CanonicalTag {
  name: string;
  color: string;
}

/**
 * The ONLY allowed tag names. Order is canonical — callers preserve this
 * order when emitting resolved tags. Colors are muted, visually-distinct
 * tones tuned for a warm dark UI; deterministic (fixed per name).
 */
export const CANONICAL_TAGS: readonly CanonicalTag[] = [
  { name: "AI & ML", color: "#7c9cf0" },        // soft indigo-blue
  { name: "Software Dev", color: "#5fae8c" },   // muted teal-green
  { name: "WordPress", color: "#4f8ec4" },      // wordpress-ish dusty blue
  { name: "Self-Hosting", color: "#6fa9a3" },   // slate cyan
  { name: "Crypto", color: "#d9a441" },         // muted gold
  { name: "Finance", color: "#5aa86f" },        // money green
  { name: "Business", color: "#b08a5a" },       // warm tan
  { name: "Marketing", color: "#d07a8a" },      // dusty rose
  { name: "Productivity", color: "#8c8ad6" },   // periwinkle
  { name: "Automotive", color: "#c47a52" },     // rust orange
  { name: "Smart Home", color: "#5fa9b8" },     // sky teal
  { name: "Faith", color: "#b89ad6" },          // soft lavender
  { name: "Health", color: "#6cba8e" },         // fresh green
  { name: "Cooking", color: "#cf8a5c" },        // terracotta
  { name: "How-To", color: "#9bab5f" },         // olive
  { name: "Personal", color: "#c98fb0" },       // mauve
  { name: "Shopping", color: "#d68f6a" },       // coral-tan
  { name: "Accounts", color: "#7f93a8" },       // cool steel
  { name: "Manufacturing", color: "#9a8f7e" },  // warm stone
  { name: "Education", color: "#6f9ed4" },      // study blue
  { name: "News", color: "#b07f7f" },           // muted brick
  { name: "Data", color: "#5b9fb0" },           // cyan-blue
  { name: "Security", color: "#c06a6a" },       // muted red
  { name: "Design", color: "#c98fc0" },         // orchid
  { name: "Media", color: "#a07fc4" },          // violet
];

const CANONICAL_NAME_SET = new Set(CANONICAL_TAGS.map((t) => t.name));
const CANONICAL_COLOR_BY_NAME = new Map(
  CANONICAL_TAGS.map((t) => [t.name, t.color] as const),
);
const CANONICAL_ORDER = new Map(
  CANONICAL_TAGS.map((t, i) => [t.name, i] as const),
);

/** Is `name` a member of the controlled vocabulary? */
export function isCanonicalTag(name: string): boolean {
  return CANONICAL_NAME_SET.has(name);
}

/** All canonical names, in canonical order (handy for prompts/UI). */
export function canonicalTagNames(): string[] {
  return CANONICAL_TAGS.map((t) => t.name);
}

/**
 * Maps each stored `theme_label` (themes-forest cluster label, may be
 * truncated to ~40 chars in storage) → 1-2 canonical tag names. Keys are the
 * EXACT stored strings. Themes that cannot be confidently matched are absent
 * (resolve to [] so callers fall through to synonym/LLM).
 */
export const THEME_TAG_MAP: Record<string, string[]> = {
  // AI cluster
  "AI productivity and assistant tools": ["AI & ML"],
  "AI development and integration infrastruct": ["AI & ML"],
  "AI-powered development platforms": ["AI & ML"],
  "AI-driven content creation tools": ["AI & ML"],
  "Enhanced Claude AI integrations and workfl": ["AI & ML"],
  // Marketing / business
  "Marketing and business growth tools": ["Marketing", "Business"],
  // Automotive
  "Jeep XJ Cherokee maintenance and upgrades": ["Automotive"],
  // Finance
  "Personal finance and business productivity": ["Finance"],
  "Financial and educational advancement oppo": ["Finance"],
  // Crypto
  "Cryptocurrency and blockchain decentralize": ["Crypto"],
  // Faith
  "Spiritual growth through faith and revelat": ["Faith"],
  // How-To
  "Practical tutorials for everyday life": ["How-To"],
  // Personal
  "Family and personal connections in digital": ["Personal"],
  "preferences links notes shopping tasks": ["Personal", "Shopping"],
  // Self-hosting
  "Self-hosted data access and management sol": ["Self-Hosting"],
  // Smart home
  "Smart home DIY automation and energy effic": ["Smart Home"],
  // Accounts
  "Online access portals login systems": ["Accounts"],
  // WordPress
  "WordPress ecosystem tools and services": ["WordPress"],
  // Health
  "Enhance human health and performance optim": ["Health"],
  // Cooking
  "BBQ and slow-cooked recipes": ["Cooking"],
  // Productivity
  "Google Workspace and data management tools": ["Productivity"],
  // Manufacturing
  "Custom digital parts fabrication solutions": ["Manufacturing"],
};

/**
 * Lowercased existing freeform tag name → canonical tag name. Collapses the
 * synonym sprawl from the old freeform AI output.
 */
export const SYNONYM_MAP: Record<string, string> = {
  // AI & ML
  "artificial intelligence": "AI & ML",
  "ai": "AI & ML",
  "a.i.": "AI & ML",
  "machine learning": "AI & ML",
  "ml": "AI & ML",
  "llm": "AI & ML",
  "llms": "AI & ML",
  "claude": "AI & ML",
  "gpt": "AI & ML",
  "chatgpt": "AI & ML",
  "generative ai": "AI & ML",
  "deep learning": "AI & ML",
  "neural networks": "AI & ML",
  // Software Dev
  "web development": "Software Dev",
  "web dev": "Software Dev",
  "software development": "Software Dev",
  "software engineering": "Software Dev",
  "development": "Software Dev",
  "open-source": "Software Dev",
  "open source": "Software Dev",
  "open-source software": "Software Dev",
  "opensource": "Software Dev",
  "programming": "Software Dev",
  "coding": "Software Dev",
  "code": "Software Dev",
  "devops": "Software Dev",
  "technology": "Software Dev",
  "tech": "Software Dev",
  "javascript": "Software Dev",
  "typescript": "Software Dev",
  "python": "Software Dev",
  "frontend": "Software Dev",
  "backend": "Software Dev",
  "api": "Software Dev",
  "github": "Software Dev",
  // Crypto
  "cryptocurrency": "Crypto",
  "crypto": "Crypto",
  "blockchain": "Crypto",
  "bitcoin": "Crypto",
  "ethereum": "Crypto",
  "web3": "Crypto",
  "defi": "Crypto",
  "nft": "Crypto",
  // Finance
  "personal finance": "Finance",
  "finance": "Finance",
  "investing": "Finance",
  "investment": "Finance",
  "money": "Finance",
  "banking": "Finance",
  "stocks": "Finance",
  // Business
  "business": "Business",
  "entrepreneurship": "Business",
  "entrepreneur": "Business",
  "business growth": "Business",
  "startup": "Business",
  "startups": "Business",
  "saas": "Business",
  // Marketing
  "marketing": "Marketing",
  "marketing automation": "Marketing",
  "ecommerce": "Marketing",
  "e-commerce": "Marketing",
  "seo": "Marketing",
  "advertising": "Marketing",
  "social media": "Marketing",
  "content marketing": "Marketing",
  "email marketing": "Marketing",
  // Productivity
  "productivity": "Productivity",
  "project management": "Productivity",
  "tools": "Productivity",
  "workflow": "Productivity",
  "note-taking": "Productivity",
  "notes": "Productivity",
  "organization": "Productivity",
  "google workspace": "Productivity",
  // Automotive
  "jeep": "Automotive",
  "offroad vehicles": "Automotive",
  "offroad": "Automotive",
  "off-road": "Automotive",
  "automotive": "Automotive",
  "cars": "Automotive",
  "vehicles": "Automotive",
  "4x4": "Automotive",
  // Smart Home
  "home automation": "Smart Home",
  "smart home": "Smart Home",
  "iot": "Smart Home",
  "home assistant": "Smart Home",
  "diy automation": "Smart Home",
  // Faith
  "religion": "Faith",
  "christianity": "Faith",
  "faith": "Faith",
  "spirituality": "Faith",
  "bible": "Faith",
  "church": "Faith",
  // Health
  "health": "Health",
  "fitness": "Health",
  "wellness": "Health",
  "nutrition": "Health",
  "medicine": "Health",
  "mental health": "Health",
  // Cooking
  "cooking": "Cooking",
  "recipes": "Cooking",
  "recipe": "Cooking",
  "food": "Cooking",
  "bbq": "Cooking",
  "grilling": "Cooking",
  "baking": "Cooking",
  // How-To
  "how-to": "How-To",
  "howto": "How-To",
  "tutorial": "How-To",
  "tutorials": "How-To",
  "guide": "How-To",
  "diy": "How-To",
  // Education
  "education": "Education",
  "learning": "Education",
  "course": "Education",
  "courses": "Education",
  "research": "Education",
  "science": "Education",
  // Self-Hosting
  "self-hosting": "Self-Hosting",
  "self-hosted": "Self-Hosting",
  "selfhosted": "Self-Hosting",
  "homelab": "Self-Hosting",
  "docker": "Self-Hosting",
  "server": "Self-Hosting",
  // WordPress
  "wordpress": "WordPress",
  "wp": "WordPress",
  "woocommerce": "WordPress",
  // Accounts
  "accounts": "Accounts",
  "login": "Accounts",
  "account": "Accounts",
  "portal": "Accounts",
  // Manufacturing
  "manufacturing": "Manufacturing",
  "3d printing": "Manufacturing",
  "cnc": "Manufacturing",
  "fabrication": "Manufacturing",
  // Data
  "data": "Data",
  "database": "Data",
  "databases": "Data",
  "analytics": "Data",
  "data science": "Data",
  // Security
  "security": "Security",
  "cybersecurity": "Security",
  "privacy": "Security",
  "infosec": "Security",
  // Design
  "design": "Design",
  "ux": "Design",
  "ui": "Design",
  "ui/ux": "Design",
  "graphic design": "Design",
  // Media
  "media": "Media",
  "video": "Media",
  "podcast": "Media",
  "music": "Media",
  "youtube": "Media",
  "streaming": "Media",
  // News
  "news": "News",
  "current events": "News",
  // Personal
  "personal": "Personal",
  "family": "Personal",
  // Shopping
  "shopping": "Shopping",
  "deals": "Shopping",
};

/**
 * Resolve up to 3 canonical tag names for a capture, from its theme label
 * and existing freeform tag names. Returns [] when nothing resolves — the
 * caller may then fall back to an LLM constrained to the vocabulary.
 *
 * - Starts from THEME_TAG_MAP[themeLabel] (the strongest signal).
 * - Adds SYNONYM_MAP hits from existingTagNames.
 * - Dedupes, sorts into canonical order, caps at 3.
 */
export function resolveCanonicalTags(input: {
  themeLabel?: string | null;
  existingTagNames?: string[];
}): string[] {
  const resolved = new Set<string>();

  const themeLabel = input.themeLabel?.trim();
  if (themeLabel) {
    const themeTags = THEME_TAG_MAP[themeLabel];
    if (themeTags) {
      for (const t of themeTags) {
        if (CANONICAL_NAME_SET.has(t)) resolved.add(t);
      }
    }
  }

  for (const raw of input.existingTagNames ?? []) {
    if (typeof raw !== "string") continue;
    const key = raw.toLowerCase().trim();
    if (!key) continue;
    const hit = SYNONYM_MAP[key];
    if (hit && CANONICAL_NAME_SET.has(hit)) resolved.add(hit);
  }

  return [...resolved]
    .sort((a, b) => (CANONICAL_ORDER.get(a) ?? 0) - (CANONICAL_ORDER.get(b) ?? 0))
    .slice(0, 3);
}

/** Deterministic color for a canonical tag name (fallback to neutral indigo). */
export function tagColor(name: string): string {
  return CANONICAL_COLOR_BY_NAME.get(name) ?? "#6366f1";
}
