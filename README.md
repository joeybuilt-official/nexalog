# Nexalog

A capture-and-synthesis app built on Next.js, powered by
[`@joeybuilt/plexo-sdk`](https://www.npmjs.com/package/@joeybuilt/plexo-sdk)
for AI features (embeddings, synthesis, voice, knowledge graph).

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL, AUTH_SECRET, PLEXO_*
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Self-Hosting Notes

Nexalog ships with two Joeybuilt-Cloud-only features that are
**disabled by default** for self-hosters:

- **Stripe billing** — checkout, customer portal, subscription status,
  and webhook routes under `/api/billing/*` and `/api/webhooks/stripe`.
  The `/app/billing` page is also hidden.
- **Super-admin coupon management** — routes under
  `/api/admin/coupons` and the `/super-admin/coupons` page.

These features are gated behind a single env var. To opt in
(only useful if you're running a paid SaaS deployment):

```bash
BILLING_ENABLED=true
```

When `BILLING_ENABLED` is unset or `false`, the routes above return
404 and the corresponding UI pages render as not-found. The
super-admin shell, broadcast messaging, and user-management views
remain available — only the billing-coupled surfaces are hidden.

Stripe-related database columns (`stripeCustomerId`, `stripePlan`,
etc.) are intentionally left in the schema; they're harmless when
billing is disabled and avoid a destructive migration for upstream
sync.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [@joeybuilt/plexo-sdk](https://www.npmjs.com/package/@joeybuilt/plexo-sdk)

## Deploy

The easiest path is the [Vercel Platform](https://vercel.com/new). For
self-hosting, any Node-18+ host with Postgres and a reachable Plexo
backend works — see `.env.example` for the full env contract.
