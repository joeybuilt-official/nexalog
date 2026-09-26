import { describe, it, expect } from "vitest";

// Unit test: validate the ![[...]] regex used by the Tiptap input rule,
// and simulate the resolve response shape.

const TRANSCLUSION_INPUT_RULE = /!\[\[([^\[\]\n]{1,200})\]\]$/;

describe("transclusion input rule regex", () => {
  it("matches ![[foo]] and captures ref", () => {
    const m = "![[foo]]".match(TRANSCLUSION_INPUT_RULE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("foo");
  });

  it("matches ![[Note Title With Spaces]]", () => {
    const m = "![[Note Title With Spaces]]".match(TRANSCLUSION_INPUT_RULE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("Note Title With Spaces");
  });

  it("matches ![[uuid]]", () => {
    const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const m = `![[${uuid}]]`.match(TRANSCLUSION_INPUT_RULE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(uuid);
  });

  it("does not match [[foo]] (wikilink syntax)", () => {
    const m = "[[foo]]".match(TRANSCLUSION_INPUT_RULE);
    expect(m).toBeNull();
  });

  it("does not match ![[multi\nline]]", () => {
    const m = "![[foo\nbar]]".match(TRANSCLUSION_INPUT_RULE);
    expect(m).toBeNull();
  });
});

describe("resolve response shape", () => {
  it("resolved note has id, title, content", () => {
    const resolved = { id: "abc-123", title: "My Note", content: "<p>Hello</p>" };
    expect(resolved).toHaveProperty("id");
    expect(resolved).toHaveProperty("title");
    expect(resolved).toHaveProperty("content");
  });
});
