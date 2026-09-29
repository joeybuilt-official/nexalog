// SPDX-License-Identifier: MIT
/**
 * The chat surface's degradation ladder (pure).
 *
 * The one assertion this file exists for: a deployment with a WORKING turn leg
 * and a DEAD retrieval leg is `ready` and NOT `grounded`, and it says so. That
 * state is the dangerous one — the answer arrives, reads as authoritative, and
 * cites nothing — and a single `available` boolean cannot express it. If a
 * future refactor collapses these fields, this test fails.
 */

import { describe, it, expect } from "vitest";

import { resolveChatReadiness } from "@/lib/chat/degrade";

const legs = (turn: "ok" | "unconfigured" | "unreachable" | "empty", brain: "ok" | "unconfigured" | "unreachable" | "empty") =>
  resolveChatReadiness({ turn, brain, legId: "leg", model: "m" });

describe("resolveChatReadiness", () => {
  it("is ready and grounded when both legs answer", () => {
    const r = legs("ok", "ok");
    expect(r).toMatchObject({ ready: true, grounded: true, degraded: false, leg: "leg", model: "m" });
    expect(r.note).toBeUndefined();
  });

  it("is ready but NOT grounded when retrieval is unreachable", () => {
    const r = legs("ok", "unreachable");
    expect(r.ready).toBe(true);
    expect(r.grounded).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.note).toContain("WITHOUT the brain");
    // It must say the answer will not cite — that is what stops a user trusting it.
    expect(r.note).toContain("will not cite");
  });

  it("treats an empty brain as grounded — a real answer, not an outage", () => {
    const r = legs("ok", "empty");
    expect(r.grounded).toBe(true);
    expect(r.note).toContain("no matching page");
  });

  it("is not ready when the turn leg is missing, and names the env var", () => {
    const r = legs("unconfigured", "ok");
    expect(r.ready).toBe(false);
    expect(r.note).toContain("CHAT_BASE_URL");
    // And it must not blame the brain — retrieval still works.
    expect(r.note).toContain("Retrieval and the reader work");
  });

  it("distinguishes a configured-but-silent leg from an unconfigured one", () => {
    expect(legs("unreachable", "ok").note).toContain("configured but did not answer");
    expect(legs("unconfigured", "ok").note).toContain("No chat leg is configured");
  });

  it("degrades on either leg and explains the one that failed", () => {
    expect(legs("unreachable", "unreachable").degraded).toBe(true);
    expect(legs("unreachable", "unreachable").note).toContain("configured but did not answer");
  });
});
