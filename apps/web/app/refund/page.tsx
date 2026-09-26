// SPDX-License-Identifier: MIT
import Link from "next/link";

export default function RefundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="mb-8 block text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="text-3xl font-bold">Refund Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: April 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-base font-semibold">Monthly plans</h2>
          <p>
            Monthly subscriptions can be cancelled anytime. No partial refunds for unused days
            in a billing period. Your access continues until the end of the period you paid for.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Annual plans</h2>
          <p>
            Annual subscriptions may be refunded within 14 days of purchase if you have not
            used the paid features substantially. Contact us at billing@nexalog.com with your
            account email.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Service issues</h2>
          <p>
            If Nexalog is unavailable for more than 24 consecutive hours in a billing period,
            we will credit your account proportionally. Contact support@nexalog.com.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Contact</h2>
          <p>
            <a href="mailto:billing@nexalog.com" className="text-copper underline">
              billing@nexalog.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
