// SPDX-License-Identifier: MIT
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: April 2026</p>

      <div className="prose prose-sm mt-8 dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-base font-semibold">What Nexalog is</h2>
          <p>
            Nexalog is a personal knowledge management platform. You capture notes, bookmarks,
            voice memos, and web content. Nexalog organises and surfaces connections between your
            ideas using AI capabilities provided by Plexo (joeybuilt.com).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">What data we store</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your email address and display name (used for authentication via Better Auth).</li>
            <li>Notes, bookmarks, and captures you create — stored in your workspace, in our database.</li>
            <li>Audio files for voice memos — stored in Cloudflare R2 object storage.</li>
            <li>AI chat history — stored per session in our database.</li>
            <li>Billing information — handled by Stripe. We store only your Stripe customer ID and subscription status, not your card details.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">How AI is used</h2>
          <p>
            AI features (chat, search, suggestions) route through Plexo, the AI platform from
            Joeybuilt LLC. Your note and bookmark content is used to ground AI responses. Plexo
            stores embeddings (numerical representations of your text) to enable semantic search.
            Your content is not used to train third-party AI models.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Workspace isolation</h2>
          <p>
            Each workspace is isolated at the database level. Data from one workspace is never
            mixed with another, including in AI context.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Data retention</h2>
          <p>
            Deleted notes enter a 30-day soft-delete period and are permanently removed after
            that. You can export all your data at any time from Settings.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Third-party services</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Stripe — payment processing</li>
            <li>Cloudflare R2 — file storage</li>
            <li>Plexo (Joeybuilt LLC) — AI routing</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">Contact</h2>
          <p>
            Questions:{" "}
            <a href="mailto:privacy@nexalog.com" className="text-copper underline">
              privacy@nexalog.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
