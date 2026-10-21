// SPDX-License-Identifier: MIT
/**
 * Is Google sign-in actually usable on this deployment?
 *
 * WHY THIS IS A SERVER FUNCTION AND NOT A `NEXT_PUBLIC_*` FLAG
 *
 * The first cut of the button was gated on `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`
 * inside the client component. That reads fine and fails silently: Next inlines
 * `NEXT_PUBLIC_*` at BUILD time, so a deployment can carry the client id and the
 * secret, look completely configured in `docker inspect`, and still render a
 * login page with no Google button — because the value was absent when the image
 * was built. Worse, flipping it needs a rebuild, not a restart, and nothing in
 * the running system says so.
 *
 * The credentials are the real gate: an OAuth client id and secret are exactly
 * what the provider needs. Deriving the button from them on the SERVER, and
 * passing the boolean down as a prop (the same way `appOrigin` already travels),
 * makes the button follow configuration instead of following the image build.
 */
export function googleLoginEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.NEXALOG_GOOGLE_CLIENT_ID && env.NEXALOG_GOOGLE_CLIENT_SECRET);
}
