// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { parseQueryDSL, serializeDSL } from "../search/query-dsl";

describe("parseQueryDSL", () => {
  it("maps kind:note → surfaces=[notes]", () => {
    const r = parseQueryDSL("kind:note meeting");
    expect(r.surfaces).toEqual(["notes"]);
    expect(r.text).toBe("meeting");
  });

  it("maps age:7d and sort:recency", () => {
    const r = parseQueryDSL("kind:bookmarks age:7d sort:recency");
    expect(r.surfaces).toEqual(["bookmarks"]);
    expect(r.ageRange).toBe("7d");
    expect(r.sort).toBe("recency");
    expect(r.text).toBe("");
  });

  it("handles is: flags", () => {
    const r = parseQueryDSL("is:evergreen is:opened");
    expect(r.evergreen).toBe(true);
    expect(r.opened).toBe(true);
    expect(r.surfaces).toEqual([]);
  });

  it("passes through unknown tokens as text", () => {
    const r = parseQueryDSL("react hooks tutorial");
    expect(r.text).toBe("react hooks tutorial");
    expect(r.surfaces).toEqual([]);
  });

  it("round-trips via serializeDSL", () => {
    const raw = "kind:notes age:30d sort:recency is:evergreen";
    const parsed = parseQueryDSL(raw);
    const rebuilt = parseQueryDSL(serializeDSL(parsed));
    expect(rebuilt.surfaces).toEqual(parsed.surfaces);
    expect(rebuilt.ageRange).toBe(parsed.ageRange);
    expect(rebuilt.sort).toBe(parsed.sort);
    expect(rebuilt.evergreen).toBe(parsed.evergreen);
  });
});
