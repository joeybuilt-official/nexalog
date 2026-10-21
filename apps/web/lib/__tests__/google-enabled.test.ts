// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { googleLoginEnabled } from "../auth/google-enabled";

/**
 * The button is gated on the CREDENTIALS, read server-side, not on a
 * `NEXT_PUBLIC_*` flag. The flag was a trap: Next inlines it at build time, so a
 * container that carries the client id and secret could still render a login
 * page with no Google button, and flipping it needed a rebuild rather than a
 * restart. These cases pin the replacement rule.
 */
describe("googleLoginEnabled", () => {
  const id = "1234.apps.googleusercontent.com";
  const secret = "GOCSPX-example";

  it("is true only when both the client id and the secret are present", () => {
    expect(
      googleLoginEnabled({
        NEXALOG_GOOGLE_CLIENT_ID: id,
        NEXALOG_GOOGLE_CLIENT_SECRET: secret,
      }),
    ).toBe(true);
  });

  it("is false with only a client id — a half-configured client cannot complete a flow", () => {
    expect(googleLoginEnabled({ NEXALOG_GOOGLE_CLIENT_ID: id })).toBe(false);
  });

  it("is false with only a secret", () => {
    expect(googleLoginEnabled({ NEXALOG_GOOGLE_CLIENT_SECRET: secret })).toBe(
      false,
    );
  });

  it("is false with empty strings, which is how an unset compose variable arrives", () => {
    expect(
      googleLoginEnabled({
        NEXALOG_GOOGLE_CLIENT_ID: "",
        NEXALOG_GOOGLE_CLIENT_SECRET: "",
      }),
    ).toBe(false);
  });

  it("is false on a deployment that sets neither", () => {
    expect(googleLoginEnabled({})).toBe(false);
  });
});
