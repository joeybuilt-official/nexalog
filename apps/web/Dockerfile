# syntax=docker/dockerfile:1
# apps/web/Dockerfile — multi-stage pnpm monorepo build, node 22-alpine.
# Requires `output: 'standalone'` in apps/web/next.config (already set).
#
# Standalone layout (Next 16 + pnpm monorepo): the runnable app is under
# .next/standalone/ with the whole pnpm tree at .next/standalone/node_modules
# and server.js at .next/standalone/apps/web/server.js. .next/static and
# public live at the apps/web source root and are laid beside server.js.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache git libc6-compat

FROM base AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @nexalog/core build && pnpm --filter @nexalog/adapters build
RUN pnpm --filter @nexalog/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3300 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache git && \
    addgroup -g 1001 -S nextjs && \
    adduser -g 1001 -u 1001 -S nextjs
WORKDIR /app
# Full standalone tree (pnpm store + apps/web/server.js)
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/standalone/ ./
# static + public laid beside server.js (apps/web/.next/static, apps/web/public)
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
USER root
RUN git config --system --add safe.directory /repo
USER nextjs
ENV BRAIN_REPO=/repo
WORKDIR /app/apps/web
EXPOSE 3300
CMD ["node", "server.js"]
