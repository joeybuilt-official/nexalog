// SPDX-License-Identifier: MIT
/**
 * The chat leg's DEFAULT MODEL has to be a name the leg actually serves.
 *
 * WHY THIS FILE EXISTS. `CHAT_MODEL` is sent on the wire VERBATIM, so a wrong
 * default is not a cosmetic slip — it is one 400 on every turn of an otherwise
 * correctly configured deployment, and it looks like "chat is broken" rather
 * than "one string is wrong". The shipped default was `litellm:auto`, which
 * reads well (it names the leg AND the model) and is not a model any gateway
 * serves:
 *
 *     {"error":{"message":"/chat/completions: Invalid model name passed in
 *      model=litellm:auto. Call `/v1/models` to view available models for your
 *      key.","code":"400"}}
 *
 * while the bare `auto` on the same gateway answers normally. The leg label has
 * its own knob (`CHAT_LEG_ID`); the model field is not where a route gets named.
 *
 * The assertion is deliberately a SHAPE, not a string equality: any default
 * without a leg-id prefix passes, so this does not pin the deployment to one
 * gateway's model group — it forbids the one mistake that cannot work anywhere.
 * Both places the default is written are checked, because they can drift apart:
 * the module constant and the compose fallback.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = join(WEB_DIR, "..", "..");

const COMPOSITION = readFileSync(join(WEB_DIR, "composition.ts"), "utf8");
const COMPOSE = readFileSync(join(REPO_ROOT, "nexalog-v2-compose.yml"), "utf8");

/** The string literal assigned to `DEFAULT_CHAT_MODEL`, or null. */
function defaultChatModelFromModule(): string | null {
  const m = COMPOSITION.match(/const DEFAULT_CHAT_MODEL\s*=\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/** The fallback in `CHAT_MODEL: ${CHAT_MODEL:-<fallback>}`. */
function defaultChatModelFromCompose(): string | null {
  const m = COMPOSE.match(/CHAT_MODEL:\s*\$\{CHAT_MODEL:-([^}]*)\}/);
  return m ? m[1].trim() : null;
}

describe("the chat leg's default model", () => {
  it("is declared in both places it can be written", () => {
    expect(defaultChatModelFromModule()).not.toBeNull();
    expect(defaultChatModelFromCompose()).not.toBeNull();
  });

  it("is not leg-id prefixed — a `:` in the model is never a servable model name", () => {
    for (const value of [defaultChatModelFromModule(), defaultChatModelFromCompose()]) {
      expect(value).toBeTruthy();
      expect(value).not.toContain(":");
    }
  });

  it("agrees between the module constant and the compose fallback", () => {
    expect(defaultChatModelFromModule()).toBe(defaultChatModelFromCompose());
  });

  it("does not ship the specific value that was rejected on the live gateway", () => {
    // The regression pin proper: `litellm:auto` is the exact string that 400s.
    expect(COMPOSITION).not.toContain('DEFAULT_CHAT_MODEL = "litellm:auto"');
    expect(COMPOSE).not.toContain("${CHAT_MODEL:-litellm:auto}");
  });
});
