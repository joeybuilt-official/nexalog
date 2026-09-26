# ADR-0010 — Offline Strategy (Service Worker + IDB Outbox)

**Status:** Accepted  
**Date:** 2026-06-27

## Context

Nexalog targets Android-first mobile users. Network reliability is inconsistent; captures and reads must work offline. No existing SW or caching layer.

## Decision

Deploy a Workbox-based service worker loaded via CDN importScripts (no npm dep for the SW itself). Register via `workbox-window` (client dep, ~5 kb). Offline outbox for mutations uses IndexedDB (P1b).

**Caching strategies:**
- Navigate requests → NetworkFirst, 3s timeout, fallback to `/offline` page
- `/_next/static/**` → CacheFirst, 200-entry cap
- `/api/today/cards`, `/api/themes/forest`, `/api/queue` → StaleWhileRevalidate
- Everything else → NetworkOnly

**Offline UI:** `/offline` page rendered from cache; `OnlineIndicator` badge in topbar (hidden when online).

## Alternatives considered

- `next-pwa` npm package — heavier, couples to Next internals, harder to customise strategies
- Workbox CLI / build-time precaching — over-engineering for current scale; add later when asset list stabilises

## Consequences

- +1 client component (`SwRegister`) added to root layout
- SW scope is `/` — covers all app routes
- IDB outbox (P1b) will use the same SW activation hook as drain trigger
