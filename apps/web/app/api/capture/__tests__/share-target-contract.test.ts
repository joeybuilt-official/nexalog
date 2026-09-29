// SPDX-License-Identifier: MIT
/**
 * Endpoint test pinning the ANDROID SHARE RECEIVER'S WIRE — POST /api/capture.
 *
 * `ShareReceiverActivity.kt` (mobile/android/.../nexalog/) posts what a user
 * shares from any app's share sheet. It shipped POSTing a JSON body
 * `{"kind":"url","content":url,"url":url}` with `Content-Type:
 * application/json`, while this route's FIRST statement is `await
 * req.formData()`: the parse threw before a single field was read, the catch
 * answered 400, and the share died with the toast "Couldn't save — try again"
 * on every share from every app. The Kotlin cannot be unit-tested in this
 * stack (no JVM/Gradle in CI; Dart/Flutter tests are not run by CI either),
 * so the contract lives here, where the route IS testable, and the receiver's
 * companion-object block cites this file — the two sides cannot drift
 * silently now:
 *
 *   1. a JSON body to this route MUST be rejected (the defect as it shipped,
 *      asserted so the old wire can never silently become legal again);
 *   2. the exact multipart body the receiver now sends MUST be accepted and
 *      produce a `link` capture with `source = "pwa-share"`.
 *
 * The route runs for real (real `Request`, real `FormData`); only the
 * composition root is faked — with the REAL `CreateCapture` use case over an
 * in-memory `BrainStore`, same pattern as the attachment-kinds test beside
 * this file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Capture,
  CreateCapture,
  type BrainStore,
  type Clock,
  type IdGen,
  type Transcoder,
  Ulid,
} from "@nexalog/core";
import { NextRequest } from "next/server";

const { getComposition } = vi.hoisted(() => ({ getComposition: vi.fn() }));
vi.mock("@/composition", () => ({ getComposition }));

import { POST } from "@/app/api/capture/route";

const ID = "0123456789ABCDEFGHJKMNPQRS";

class FakeBrainStore implements BrainStore {
  readonly captures: Capture["state"][] = [];

  async saveCapture(capture: Capture): Promise<void> {
    this.captures.push(capture.state);
  }
  async getCapture() {
    return null;
  }
  async listCaptures() {
    return [];
  }
  async updateCapture(): Promise<void> {
    throw new Error("not used");
  }
  async getPage() {
    return null;
  }
  async savePage(): Promise<void> {
    throw new Error("not used");
  }
  async saveAttachment(_input: { name: string; kind: string; bytes: Uint8Array }): Promise<{ path: string }> {
    throw new Error("not used");
  }
}

function wireComposition() {
  const store = new FakeBrainStore();
  const ids: IdGen = { newUlid: () => Ulid.of(ID), newCapturedAt: () => new Date("2026-09-29T00:00:00Z") };
  const clock: Clock = { now: () => new Date("2026-09-29T00:00:00Z") };
  const transcoder: Transcoder = { toOpus: async (bytes) => bytes };
  getComposition.mockReturnValue({ createCapture: new CreateCapture(store, ids, clock, transcoder) });
  return store;
}

/**
 * The wire EXACTLY as ShareReceiverActivity.kt builds it — hand-rolled
 * multipart with a `boundary`, `Content-Type: multipart/form-data; boundary=…`,
 * no `Content-Length` (HttpURLConnection sets it), form-data parts named
 * `url` and `source` with `Content-Type: text/plain` and CRLF separators.
 * Mirroring the construction (rather than using a FormData helper) is the
 * point: the Kotlin does not have FormData either, so this proves the raw
 * hand-built encoding is what `req.formData()` accepts.
 */
const RECEIVER_BOUNDARY = "nexalog-share-1790678400000";
const RECEIVER_CRLF = "\r\n";

function receiverBody(url: string, source: string): Uint8Array {
  const encoder = new TextEncoder();
  const field = (name: string, value: string) =>
    encoder.encode(
      `--${RECEIVER_BOUNDARY}${RECEIVER_CRLF}` +
        `Content-Disposition: form-data; name="${name}"${RECEIVER_CRLF}` +
        `Content-Type: text/plain; charset=utf-8${RECEIVER_CRLF}` +
        RECEIVER_CRLF +
        value +
        RECEIVER_CRLF,
    );
  const closing = encoder.encode(`--${RECEIVER_BOUNDARY}--${RECEIVER_CRLF}`);
  const urlPart = field("url", url);
  const sourcePart = field("source", source);
  const body = new Uint8Array(urlPart.length + sourcePart.length + closing.length);
  body.set(urlPart, 0);
  body.set(sourcePart, urlPart.length);
  body.set(closing, urlPart.length + sourcePart.length);
  return body;
}

/** A `Request` shaped like the HttpURLConnection call: method, two headers, raw bytes. */
function receiverRequest(body: Uint8Array, contentType: string): NextRequest {
  return new NextRequest("http://localhost/api/capture", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Accept: "application/json",
      // The mobile client is a native bearer client (auth verified before this
      // point in production; auth itself is not this test's subject).
      Authorization: "Bearer test-token-not-verified-here",
      "User-Agent": "NexalogShareReceiver/1.0",
    },
    body: body as unknown as BodyInit,
  });
}

beforeEach(() => {
  getComposition.mockReset();
});

describe("POST /api/capture — the Android share-target wire (ShareReceiverActivity)", () => {
  it("a JSON body — the OLD receiver wire — is REJECTED (400), never captured", async () => {
    const store = wireComposition();

    // Exactly what ShareReceiverActivity.kt sent before the fix.
    const json = new TextEncoder().encode(
      JSON.stringify({ kind: "url", content: "https://example.com/shared", url: "https://example.com/shared" }),
    );
    const response = await POST(receiverRequest(json, "application/json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: expect.stringMatching(/form-data|multipart|.urlencoded/i) });
    expect(store.captures).toHaveLength(0); // nothing landed — the user-visible failure
  });

  it("the receiver's multipart wire {url, source=pwa-share} is ACCEPTED as a link capture", async () => {
    const store = wireComposition();

    const response = await POST(
      receiverRequest(
        receiverBody("https://example.com/shared", "pwa-share"),
        `multipart/form-data; boundary=${RECEIVER_BOUNDARY}`,
      ),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, captureId: ID });

    expect(store.captures).toHaveLength(1);
    const capture = store.captures[0];
    expect(capture.kind).toBe("link");
    expect(capture.originUrl).toBe("https://example.com/shared");
    expect(capture.body).toBe("https://example.com/shared");
    expect(capture.source).toBe("pwa-share");
  });

  it("the response the receiver parses: 201 + {ok:true, captureId} — and no `duplicate` field on this route", async () => {
    const store = wireComposition();

    const response = await POST(
      receiverRequest(
        receiverBody("https://example.com/again", "pwa-share"),
        `multipart/form-data; boundary=${RECEIVER_BOUNDARY}`,
      ),
    );
    const shape = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(shape.ok).toBe(true);
    expect(typeof shape.captureId).toBe("string");
    // The OLD Kotlin read `duplicate` out of this body to stay silent on a
    // re-share; this route NEVER sets it. Asserting its absence pins the
    // response contract the receiver's toast logic must be written against.
    expect("duplicate" in shape).toBe(false);
  });
});