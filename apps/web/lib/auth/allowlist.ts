// SPDX-License-Identifier: MIT
/**
 * The single-account door.
 *
 * Nexalog is one person's second brain: one Google account owns the mailbox-side
 * data, one account holds the notes. `emailAndPassword.disableSignUp` does NOT
 * deliver that — it governs the email/password provider only, and a SOCIAL
 * provider creates a user row for whoever completes the OAuth flow. Enabling
 * Google without this list would open the app to every Google account on earth,
 * which is the exact opposite of the intent.
 *
 * So the rule lives here, as plain data and one pure predicate, and the auth
 * layer enforces it on BOTH paths it can be reached by:
 *   - `user.create` — a NEW row (social sign-up, or any other create) is refused;
 *   - `session.create` — an EXISTING row (a pre-Google account, or one created
 *     before this gate existed) still cannot obtain a session.
 * A gate on only the first path lets a blocked user with an old row walk in.
 *
 * Adding an address here is the whole act of inviting someone. Keep the list
 * literal and short: an env var would make "who may use this" a deployment
 * detail nobody reviews.
 */
export const ALLOWED_EMAILS: readonly string[] = ["dustin.olenslager@gmail.com"];

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
