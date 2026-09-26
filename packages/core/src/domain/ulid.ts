/**
 * Ulid — a 26-character sortable unique identifier.
 *
 * Nexalog capture files are named `<ulid>.md` in the brain repo, so the ID must
 * be lexicographically sortable (which orders the inbox by capture time) and
 * safe as a filename. This is a *value object*: it only validates shape; the
 * actual generation lives behind the `IdGen` port so `core` stays pure.
 */

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export class Ulid {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static of(value: string): Ulid {
    if (!ULID_RE.test(value)) {
      throw new Error(`Invalid ULID: "${value}" (must be 26 Crockford base32 chars)`);
    }
    return new Ulid(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: Ulid): boolean {
    return this.value === other.value;
  }
}
