/**
 * Slug — a brain-repo page identifier.
 *
 * A slug is the path (without `.md`) of a page inside the brain repo, e.g.
 * `people/example-person` or `notes/legacy/some-import`. It is the key the
 * `BrainStore` and `BrainIndex` both agree on. Normalization is a domain rule:
 * lowercased, forward-slash separated, no leading/trailing slash, no `.md`.
 */

const SAFE_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/;

export class Slug {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /** Build a slug from a path-like string, normalizing aggressively. */
  static of(input: string): Slug {
    let s = input.trim().toLowerCase();
    s = s.replace(/\\/g, "/");
    s = s.replace(/\.md$/i, "");
    s = s.replace(/^\/+|\/+$/g, "");
    s = s.replace(/\/{2,}/g, "/");
    if (s === "") {
      throw new Error("Slug cannot be empty");
    }
    for (const seg of s.split("/")) {
      if (!SAFE_SEGMENT_RE.test(seg)) {
        throw new Error(`Invalid slug segment: "${seg}" in "${s}"`);
      }
    }
    return new Slug(s);
  }

  /** The filesystem path (with `.md`) inside the repo. */
  toFilePath(): string {
    return `${this.value}.md`;
  }

  toString(): string {
    return this.value;
  }

  equals(other: Slug): boolean {
    return this.value === other.value;
  }
}
