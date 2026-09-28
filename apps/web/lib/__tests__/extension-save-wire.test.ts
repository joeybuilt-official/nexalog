// SPDX-License-Identifier: MIT
/**
 * The extension's save wire: `extension-store/background.js` must send what the
 * routes it targets can actually parse.
 *
 * The defect this pins (pre-existing, not introduced by the bookmark work):
 * BOTH saves posted `JSON.stringify({kind,content})` with
 * `Content-Type: application/json` at `/api/capture`, whose handler calls
 * `request.formData()`. A JSON body makes that throw on the first line
 * ("Content-Type was not one of multipart/form-data or
 * application/x-www-form-urlencoded"), the route's catch returns
 * `400 {ok:false}`, and the response never carries `captureId` — so the popup
 * read null and reported a generic server error. Every save from the extension
 * failed, which is exactly what the browser-side `captureOrQueue` fix
 * (`lib/__tests__/capture-or-queue.test.ts`) had already corrected in the app.
 *
 * Two assertions that are easy to get wrong in opposite directions:
 *   - a URL save is a BOOKMARK: JSON `{url}` to `/api/bookmarks`, the route
 *     that reads a JSON body, with `application/json` set EXPLICITLY;
 *   - a highlight is TEXT: a real `FormData` to `/api/capture` with NO
 *     hand-written Content-Type, because the multipart boundary must come from
 *     the browser.
 *
 * HOW THIS LOADS A SERVICE WORKER. `background.js` is not importable: it is a
 * chrome extension service worker with no module system, and it registers
 * listeners at top level against a `chrome` global that does not exist in
 * vitest. So the file's SOURCE is evaluated in a `node:vm` sandbox with a
 * stubbed `chrome` and a stubbed `fetch`, and the two save functions are pulled
 * out and CALLED. These are therefore behavioural assertions about the real
 * function bodies — not a regex over the file's text — with the one caveat that
 * the surrounding chrome API is stubbed (the stub must grow when the worker
 * starts using a chrome API it does not use today).
 *
 * `fetch` is faked and nothing here needs a network, a DB, or a browser.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "extension-store");
const WORKER_PATH = join(EXTENSION_DIR, "background.js");

type SaveResult = {
  ok: boolean;
  duplicate?: boolean;
  kind?: string | null;
  label?: string;
  captureId?: string | null;
  error?: string;
  status?: number;
  base?: string;
};

type WorkerApi = {
  BASE: string;
  saveBookmark: (url: string) => Promise<SaveResult>;
  saveHighlight: (text: string, sourceUrl?: string) => Promise<SaveResult>;
};

type FetchCall = { url: string; init: RequestInit | undefined };

/**
 * A stand-in for the chrome namespace. The APIs `background.js` touches today
 * are explicit (and the message listener is captured so the popup's channel can
 * be exercised); anything else resolves to an inert callable, so an unrelated
 * chrome API added to the worker later does not make this test explode. `then`
 * is deliberately absent from every inert node, so `await chrome.storage…` can
 * never be mistaken for a thenable.
 */
function makeChromeStub(captured: { onMessage?: (...args: unknown[]) => unknown }) {
  const inert: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === "then" ? undefined : inert),
    apply: () => undefined,
  });
  const addListener = () => {};
  const base = {
    runtime: {
      getURL: (p: string) => p,
      onInstalled: { addListener },
      onMessage: {
        addListener: (fn: (...args: unknown[]) => unknown) => {
          captured.onMessage = fn;
        },
      },
    },
    action: { setBadgeBackgroundColor: addListener, setBadgeText: addListener },
    notifications: { create: addListener },
    contextMenus: { create: addListener, onClicked: { addListener } },
    commands: { onCommand: { addListener } },
    tabs: { query: async () => [], create: addListener, update: addListener },
    omnibox: {
      setDefaultSuggestion: addListener,
      onInputChanged: { addListener },
      onInputEntered: { addListener },
    },
  };
  return new Proxy(base, {
    get: (target, prop) => {
      const value = Reflect.get(target, prop);
      return value === undefined ? inert : value;
    },
  });
}

/** Evaluate background.js in a sandbox and hand back its two save functions. */
function loadWorker(fetchImpl: typeof fetch, captured: { onMessage?: (...args: unknown[]) => unknown }): WorkerApi {
  const sandbox = vm.createContext({
    chrome: makeChromeStub(captured),
    fetch: fetchImpl,
    FormData,
    Response,
    URL,
    setTimeout,
    console,
  });
  const source = readFileSync(WORKER_PATH, "utf8");
  // Re-evaluating the file with an export expression appended is what makes the
  // worker's top-level functions reachable from the test: they are script
  // declarations, not module exports. Renaming either function fails here
  // loudly rather than silently asserting nothing.
  return vm.runInContext(
    `${source}\n;({ saveBookmark, saveHighlight, BASE });`,
    sandbox,
    { filename: "extension-store/background.js" },
  ) as WorkerApi;
}

let calls: FetchCall[];

/** A fresh Response per call — bodies are single-use. */
function stubFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((r) => url.endsWith(r));
    const route = key ? routes[key] : { status: 500, body: { error: "unexpected_route" } };
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const BOOKMARK_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  kindClassified: "article",
  url: "https://example.com/docker-guide",
};

beforeEach(() => {
  calls = [];
});

describe("extension save wire — saveBookmark (the URL path)", () => {
  it("POSTs JSON {url} to /api/bookmarks — the route that parses a JSON body", async () => {
    const fetchMock = stubFetch({
      "/api/bookmarks": { status: 201, body: { ok: true, duplicate: false, bookmark: BOOKMARK_ROW } },
    });
    const worker = loadWorker(fetchMock, {});

    await worker.saveBookmark("https://example.com/docker-guide");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe(`${worker.BASE}/api/bookmarks`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(calls[0].init?.headers).toEqual({ "Content-Type": "application/json" });
    // `kind`/`content` was the old capture body — the bookmark route is
    // `.strict()`, so that shape would be a 400 `invalid_body`.
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ url: "https://example.com/docker-guide" });
  });

  it("reads the real response shape: bookmark.id and bookmark.kindClassified", async () => {
    const fetchMock = stubFetch({
      "/api/bookmarks": { status: 201, body: { ok: true, duplicate: false, bookmark: BOOKMARK_ROW } },
    });
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveBookmark("https://example.com/docker-guide");

    expect(result).toEqual({
      ok: true,
      kind: "article",
      label: "Articles",
      captureId: BOOKMARK_ROW.id,
      base: worker.BASE,
    });
  });

  it("still maps the kind through hopperLabel — the existing mapping, unchanged", async () => {
    const kinds: Array<[string, string]> = [
      ["video", "Videos"],
      ["article", "Articles"],
      ["reference", "Reference"],
      ["social", "Social"],
      ["other", "Bookmarks"],
    ];

    for (const [kindClassified, label] of kinds) {
      calls = [];
      // A fresh worker per kind: the fetch stub closes over the routes it was
      // built with, and the assertion is about the label mapping alone.
      const fetchMock = stubFetch({
        "/api/bookmarks": {
          status: 201,
          body: { ok: true, duplicate: false, bookmark: { ...BOOKMARK_ROW, kindClassified } },
        },
      });
      const worker = loadWorker(fetchMock, {});

      const result = await worker.saveBookmark("https://example.com/x");

      expect(result.label, kindClassified).toBe(label);
    }
  });

  it("reports a duplicate from `duplicate`, keeping the existing row's id", async () => {
    const fetchMock = stubFetch({
      "/api/bookmarks": { status: 200, body: { ok: true, duplicate: true, bookmark: BOOKMARK_ROW } },
    });
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveBookmark("https://example.com/docker-guide");

    expect(result).toEqual({ ok: true, duplicate: true, captureId: BOOKMARK_ROW.id, base: worker.BASE });
  });

  it("keeps the auth-failure semantics: a 401 is `auth`, never a status error", async () => {
    const fetchMock = stubFetch({ "/api/bookmarks": { status: 401, body: { error: "Unauthorized" } } });
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveBookmark("https://example.com/x");

    expect(result).toEqual({ ok: false, error: "auth", base: worker.BASE });
  });

  it("keeps the auth-failure semantics: a redirect to /login is `auth` too", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const res = new Response("<html></html>", { status: 405, headers: { "Content-Type": "text/html" } });
      Object.defineProperty(res, "url", { value: `${new URL(url).origin}/login` });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveBookmark("https://example.com/x");

    expect(result.error).toBe("auth");
  });
});

describe("extension save wire — saveHighlight (the text path)", () => {
  it("POSTs a real FormData to /api/capture with NO hand-written Content-Type", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 201, body: { ok: true, captureId: "cap-1" } } });
    const worker = loadWorker(fetchMock, {});

    await worker.saveHighlight("some selected text", "https://example.com/page");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe(`${worker.BASE}/api/capture`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    // A hand-written Content-Type omits the multipart boundary, and that is
    // exactly how `request.formData()` came to throw server-side.
    expect(calls[0].init?.headers).toBeUndefined();
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
  });

  it("carries `text` (with the source URL appended, as before) and `source: bookmarklet`", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 201, body: { ok: true, captureId: "cap-1" } } });
    const worker = loadWorker(fetchMock, {});

    await worker.saveHighlight("some selected text", "https://example.com/page");

    const form = calls[0].init?.body as FormData;
    expect(form.get("text")).toBe("some selected text\n\nSource: https://example.com/page");
    expect(form.get("source")).toBe("bookmarklet");
  });

  it("appends no source line when the highlight has no page URL", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 201, body: { ok: true, captureId: "cap-1" } } });
    const worker = loadWorker(fetchMock, {});

    await worker.saveHighlight("standalone", undefined);

    expect((calls[0].init?.body as FormData).get("text")).toBe("standalone");
  });

  it("surfaces the capture id from the 201 body", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 201, body: { ok: true, captureId: "cap-1" } } });
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveHighlight("text", "https://example.com/p");

    expect(result.ok).toBe(true);
    expect(result.captureId).toBe("cap-1");
  });

  it("reports a refusal as a status error, not as a success", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 400, body: { ok: false, error: "capture failed" } } });
    const worker = loadWorker(fetchMock, {});

    const result = await worker.saveHighlight("text", "https://example.com/p");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("keeps the auth-failure semantics on the highlight path too", async () => {
    const fetchMock = stubFetch({ "/api/capture": { status: 401, body: {} } });
    const worker = loadWorker(fetchMock, {});

    expect((await worker.saveHighlight("text", "https://example.com/p")).error).toBe("auth");
  });
});

describe("extension save wire — the popup's channel", () => {
  it("sends the popup the fields it renders, and keeps the channel open", async () => {
    const fetchMock = stubFetch({
      "/api/bookmarks": { status: 201, body: { ok: true, duplicate: false, bookmark: BOOKMARK_ROW } },
    });
    const captured: { onMessage?: (...args: unknown[]) => unknown } = {};
    const worker = loadWorker(fetchMock, captured);
    expect(typeof captured.onMessage).toBe("function");

    const result = await new Promise<SaveResult>((resolve) => {
      const keepAlive = captured.onMessage!({ type: "save", url: "https://example.com/x" }, {}, resolve);
      // `return true` is what keeps the message port open for the async reply;
      // without it the popup's sendMessage resolves undefined.
      expect(keepAlive).toBe(true);
    });

    expect(result).toMatchObject({ ok: true, label: "Articles", captureId: BOOKMARK_ROW.id, base: worker.BASE });
  });

  it("renders nothing the popup does not read — popup.js's field names all exist on a real result", async () => {
    const popup = readFileSync(join(EXTENSION_DIR, "popup.js"), "utf8");
    // `res.ok` / `res.duplicate` / `res.label` / `res.captureId` / `res.base` /
    // `res.error` / `res.status` — every field the popup touches. A rename in
    // either file must not be able to land half-done.
    const readFields = new Set(
      [...popup.matchAll(/\bres\??\.(\w+)/g)].map((m) => m[1]),
    );
    expect(readFields.size).toBeGreaterThan(0);

    const success = loadWorker(
      stubFetch({ "/api/bookmarks": { status: 201, body: { ok: true, duplicate: false, bookmark: BOOKMARK_ROW } } }),
      {},
    );
    const duplicate = loadWorker(
      stubFetch({ "/api/bookmarks": { status: 200, body: { ok: true, duplicate: true, bookmark: BOOKMARK_ROW } } }),
      {},
    );
    const failure = loadWorker(
      stubFetch({ "/api/bookmarks": { status: 500, body: {} } }),
      {},
    );

    const shapes = [
      await success.saveBookmark("https://example.com/x"),
      await duplicate.saveBookmark("https://example.com/x"),
      await failure.saveBookmark("https://example.com/x"),
    ];
    const provided = new Set(shapes.flatMap((s) => Object.keys(s)));

    for (const field of readFields) {
      expect(provided, `popup.js reads res.${field}`).toContain(field);
    }
  });
});
