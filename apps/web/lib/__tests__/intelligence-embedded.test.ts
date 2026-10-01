// SPDX-License-Identifier: MIT
/**
 * The embedded adapter and the port resolver — the edge where a wire shape is
 * allowed to exist.
 *
 * The adapter talks to an OpenAI-compatible endpoint with raw `fetch` (no SDK),
 * so the endpoint is a stubbed `fetch` here: the test asserts the REQUEST the
 * adapter builds (URL, bearer, model, messages) and that every failure mode is
 * converted into the port's own typed `IntelligenceError` rather than leaking a
 * vendor error. `resolveIntelligence` is asserted to be env-driven and to answer
 * `null` — not an error — when nothing is configured.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EmbeddedIntelligenceAdapter } from "@/lib/intelligence/embedded-adapter";
import { IntelligenceError } from "@/lib/intelligence/port";
import { resolveIntelligence } from "@/lib/intelligence/resolve";
import { DEFAULT_LLM_MODEL, llmConfig } from "@/lib/env";

const CONFIG = { baseUrl: "https://model.example.com/", apiKey: "test-key", model: "test-model" };

function fakeResponse(init: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: init.json ?? (async () => ({})),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("llmConfig — model identity is configuration", () => {
  it("is null unless BOTH the base URL and the key are set", () => {
    expect(llmConfig({})).toBeNull();
    expect(llmConfig({ LLM_BASE_URL: "https://x.example.com" })).toBeNull();
    expect(llmConfig({ LLM_API_KEY: "k" })).toBeNull();
  });

  it("trims the URL and defaults the model", () => {
    expect(llmConfig({ LLM_BASE_URL: "https://x.example.com/  ", LLM_API_KEY: " k " })).toEqual({
      baseUrl: "https://x.example.com",
      apiKey: "k",
      model: DEFAULT_LLM_MODEL,
    });
  });

  it("honours an explicit model", () => {
    expect(
      llmConfig({ LLM_BASE_URL: "https://x.example.com", LLM_API_KEY: "k", LLM_MODEL: "big" })?.model,
    ).toBe("big");
  });
});

describe("resolveIntelligence", () => {
  it("is null with no configuration — the honest standalone state", () => {
    expect(resolveIntelligence({})).toBeNull();
  });

  it("returns the embedded adapter when configured", () => {
    const port = resolveIntelligence({
      LLM_BASE_URL: "https://x.example.com",
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
    });
    expect(port).not.toBeNull();
    expect(port!.id).toBe("embedded");
    expect(port!.model).toBe("m");
  });
});

describe("EmbeddedIntelligenceAdapter — the request it builds", () => {
  it("POSTs an OpenAI-compatible chat completion with the configured model", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        ok: true,
        json: async () => ({ model: "answered-model", choices: [{ message: { content: "hello" } }] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new EmbeddedIntelligenceAdapter(CONFIG);
    const result = await adapter.complete({ system: "be terse", prompt: "say hi", maxTokens: 10, temperature: 0.1 });

    expect(result).toEqual({ text: "hello", model: "answered-model" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://model.example.com/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "say hi" },
    ]);
    expect(body.max_tokens).toBe(10);
    expect(body.temperature).toBe(0.1);
  });

  it("omits the system message when none was given", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: true, json: async () => ({ choices: [{ message: { content: "x" } }] }) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new EmbeddedIntelligenceAdapter(CONFIG).complete({ prompt: "only" });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages).toEqual([{ role: "user", content: "only" }]);
    expect(body.max_tokens).toBeUndefined();
  });

  it("reads the completion shape too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: true, json: async () => ({ choices: [{ text: "completion" }] }) })),
    );
    const result = await new EmbeddedIntelligenceAdapter(CONFIG).complete({ prompt: "p" });
    expect(result.text).toBe("completion");
    // Falls back to the configured model when the endpoint reports none.
    expect(result.model).toBe("test-model");
  });
});

describe("EmbeddedIntelligenceAdapter — failures stay in the port's vocabulary", () => {
  it("maps a transport failure to `transport`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    await expect(new EmbeddedIntelligenceAdapter(CONFIG).complete({ prompt: "p" })).rejects.toMatchObject({
      name: "IntelligenceError",
      code: "transport",
    });
  });

  it("maps a non-2xx answer to `status` with the status attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ ok: false, status: 429 })));
    const error = await new EmbeddedIntelligenceAdapter(CONFIG)
      .complete({ prompt: "p" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntelligenceError);
    expect((error as IntelligenceError).code).toBe("status");
    expect((error as IntelligenceError).status).toBe(429);
  });

  it("maps unreadable JSON to `malformed`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    })));
    await expect(new EmbeddedIntelligenceAdapter(CONFIG).complete({ prompt: "p" })).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("maps an answer with no assistant text to `malformed`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ ok: true, json: async () => ({ choices: [] }) })));
    await expect(new EmbeddedIntelligenceAdapter(CONFIG).complete({ prompt: "p" })).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
