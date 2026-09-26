// SPDX-License-Identifier: MIT
import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: April 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-base font-semibold">Service</h2>
          <p>
            Nexalog is a personal knowledge management platform operated by Joeybuilt LLC.
            By using Nexalog you agree to these terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Your content</h2>
          <p>
            You own everything you create in Nexalog. We do not claim ownership of your notes,
            bookmarks, or any other content. We only use your content to provide the service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Acceptable use</h2>
          <p>
            Do not use Nexalog to store or distribute illegal content, malware, or content that
            violates others&apos; rights. We may suspend accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Billing</h2>
          <p>
            Paid plans are billed monthly or annually through Stripe. You can cancel anytime
            from the billing page. Cancellation takes effect at the end of the current billing
            period.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Service availability</h2>
          <p>
            We aim for high availability but do not guarantee uninterrupted service. We are not
            liable for data loss, though we take data integrity seriously (see our Privacy
            Policy).
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Changes</h2>
          <p>
            We may update these terms. We will notify users of material changes by email.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Contact</h2>
          <p>
            <a href="mailto:legal@nexalog.com" className="text-copper underline">
              legal@nexalog.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
