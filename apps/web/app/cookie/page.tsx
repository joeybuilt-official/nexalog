// SPDX-License-Identifier: MIT
import Link from "next/link";

export default function CookiePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="text-3xl font-bold">Cookie Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: April 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-base font-semibold">Cookies we use</h2>
          <p>
            Nexalog uses a single session cookie (<code>better-auth.session_token</code>) to keep
            you signed in. This cookie is strictly necessary for the service to work — it contains
            an encrypted session token and nothing else.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">No tracking cookies</h2>
          <p>
            We do not use analytics cookies, advertising cookies, or any third-party tracking
            cookies. We do not use Google Analytics, Facebook Pixel, or similar services.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Cookie duration</h2>
          <p>
            The session cookie lasts for your browser session or 30 days if you choose &quot;stay
            signed in&quot;. It is cleared when you sign out.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Your choices</h2>
          <p>
            Blocking the session cookie will prevent you from signing in. You can clear it by
            signing out or clearing your browser data.
          </p>
        </section>
      </div>
    </div>
  );
}
