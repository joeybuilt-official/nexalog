// SPDX-License-Identifier: MIT
/**
 * The door: two invited addresses, and nobody else.
 *
 * Nexalog's auth lives in the shared `auth` schema, and that `user` table also
 * holds rows from sibling apps. Two addresses are people who may use this app —
 * the owner and his son — and the point of this file is that no third row may
 * be created and no other row may obtain a session. `emailAndPassword.
 * disableSignUp` does NOT deliver that: it governs the email/password provider
 * only, and a SOCIAL provider creates a user row for whoever completes the
 * OAuth flow.
 *
 * So the rule lives here, as plain data and one pure predicate, and the auth
 * layer enforces it on BOTH paths it can be reached by:
 *   - `user.create` — a NEW row (social sign-up, or any other create) is refused;
 *   - `session.create` — an EXISTING row (an account predating this gate) still
 *     cannot obtain a session.
 * A gate on only the first path lets a blocked user with an old row walk in.
 *
 * An invited address that ALREADY owns a row is not a duplicate risk: Better
 * Auth looks the user up by email before it creates anything, and the Google
 * account is linked onto that existing row (see `account.accountLinking` in
 * `lib/auth.ts`). That is what lets an address that registered with a password
 * before Google existed keep the same notes when it signs in with Google, and
 * it is pinned by `lib/__tests__/auth-account-linking.test.ts`.
 *
 * Adding an address here is the whole act of inviting someone. Keep the list
 * literal and short: an env var would make "who may use this" a deployment
 * detail nobody reviews.
 */
export const ALLOWED_EMAILS: readonly string[] = [
  /** The owner. */
  "dustin.olenslager@gmail.com",
  /** Abe — invited 2026-10-21, on an address that already owns a credential row. */
  "abeole21@gmail.com",
];

/**
 * Emails are compared in one canonical form because every source disagrees on
 * case and stray whitespace: Google returns them lowercased, a login form does
 * not, and a paste from a mail client arrives with neither. "Dustin.Olenslager
 * @Gmail.com " is the same person as the entry above, and must be admitted.
 */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** True only for an address on {@link ALLOWED_EMAILS}. `null`/`""` are refused. */
export function isAllowedEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && ALLOWED_EMAILS.includes(normalized);
}
