/**
 * IdGen + Clock — production implementations.
 *
 * Ulid generation uses a time + random encoding (Crockford base32). This is the
 * only place randomness/time enter the domain; use cases depend on the port,
 * so tests can inject deterministic generators.
 *
 * Monotonicity: ULIDs generated within the same millisecond must still sort in
 * generation order, so when the clock has not advanced we increment the random
 * component (big-endian, 80 bits) instead of re-randomising it. The caller
 * contract is "a ULID generated later never sorts before an earlier one" —
 * without this, same-ms ids have random relative order and the capture inbox
 * (sorted by id) loses its chronology.
 */

import { Ulid, IdGen, Clock } from "@nexalog/core";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 10 Crockford base32 chars — 48-bit ms timestamp, sortable. */
function encodeTime(ms: number): string {
  let t = "";
  let v = ms;
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[v % 32] + t;
    v = Math.floor(v / 32);
  }
  return t;
}

/** 16 random base32 values (0–31), big-endian. 80 bits of entropy. */
function randomBits(): number[] {
  const out: number[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Math.floor(Math.random() * 32);
  }
  return out;
}

export class SystemIdGen implements IdGen {
  private lastMs = -1;
  private lastBits: number[] = [];

  newUlid(): Ulid {
    const now = Date.now();
    let ms = now;

    if (now === this.lastMs && this.lastBits.length === 16) {
      // Same millisecond — increment the previous random component so the new
      // id sorts strictly after it. Carry propagates toward the most
      // significant base32 digit; overflow (2^80 ids in one ms) bumps the
      // timestamp by 1ms instead of wrapping.
      let i = 15;
      while (i >= 0 && this.lastBits[i] === 31) {
        this.lastBits[i] = 0;
        i--;
      }
      if (i < 0) {
        ms = this.lastMs + 1;
        this.lastBits = randomBits();
      } else {
        this.lastBits[i] += 1;
      }
    } else {
      this.lastBits = randomBits();
    }
    this.lastMs = ms;

    return Ulid.of(encodeTime(ms) + this.lastBits.map((v) => CROCKFORD[v]).join(""));
  }

  newCapturedAt(): Date {
    return new Date();
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
