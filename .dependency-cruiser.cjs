// dependency-cruiser config for nexalog.
// Inward-only Clean Architecture guard, encoding .agents/rules/clean-architecture.md → Review
// checklist item 1 (import direction) + the locked decisions (core = pure TS, zero runtime deps;
// adapters depend on core only).
//
// Severity ladder (same convention as fylo):
//   error  — rule is currently CLEAN on main; a regression fails `pnpm depcruise`
//   warn   — known-existing violations exist on main; advisory until an incremental cleanup
//            lands. Document the baseline, then ratchet to `error`.
//
// Everything else in the review checklist (no vendor types in slices, DTO boundaries, port +
// test-double pairing) is not mechanically checkable per-diff and stays review-only for now.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: "no-circular",
            severity: "warn",
            comment:
                "Circular deps are a smell — break the cycle via a shared module or an interface.",
            from: {},
            to: { circular: true },
        },
        {
            name: "core-is-pure",
            severity: "error",
            comment:
                "packages/core is pure TypeScript with ZERO runtime dependencies (locked decision). " +
                "No npm packages, no node builtins anywhere in the package — no zod, no fs/fetch/db. " +
                "Ports live here; implementations do not. Scope is the whole package (minus test/ and " +
                "vitest.config.ts): a file at the package root must not escape the rule. `unknown` " +
                "included: a bare specifier that does not resolve still means someone reached for a " +
                "dependency.",
            from: {
                path: "^packages/core",
                pathNot: "(^|/)(test|__tests__)(/|$)|vitest\\.config\\.ts$",
            },
            to: {
                dependencyTypes: [
                    "npm",
                    "npm-dev",
                    "npm-optional",
                    "npm-peer",
                    "npm-bundled",
                    "core",
                    "unknown",
                ],
            },
        },
        {
            name: "core-no-outer-layers",
            severity: "error",
            comment:
                "The domain must not know about adapters or apps. Dependencies point inward only.",
            from: { path: "^packages/core" },
            to: { path: "^(packages/adapters|apps/)" },
        },
        {
            name: "adapters-no-apps",
            severity: "error",
            comment: "packages/adapters depends on core only — never on apps/web.",
            from: { path: "^packages/adapters" },
            to: { path: "^apps/" },
        },
        {
            name: "web-lib-no-ui",
            severity: "error",
            comment:
                "lib/<feature> slices (domain rules + use cases) must NOT import from the UI: " +
                "app/, components/, or middleware.ts. UI depends on lib, never the reverse. " +
                "(clean-architecture.md checklist item 1)",
            from: { path: "^apps/web/lib" },
            to: { path: "^(apps/web/(app|components)/|apps/web/middleware\\.ts$)" },
        },
        {
            name: "web-lib-no-direct-db",
            severity: "warn",
            comment:
                "lib/<feature> slices should reach persistence through a port (pattern to copy: " +
                "lib/intelligence/port.ts) or the composition root — not import lib/db directly. " +
                "Existing call sites are baselined as `warn`; ratchet to `error` after the slices " +
                "move their storage behind adapters. (clean-architecture.md checklist item 1)",
            from: { path: "^apps/web/lib/(?!(db|__tests__)/)" },
            to: { path: "^apps/web/lib/db" },
        },
    ],
    options: {
        doNotFollow: { path: "node_modules" },
        // Path-anchored excludes. Every entry is a regex matched against the WHOLE path, so a bare
        // `build` also excludes `lib/export/build-archive.ts` and a bare `mobile` also excludes
        // `components/mobile-bottom-nav.tsx` — silently shrinking the policed surface.
        // `scripts/check-architecture.mjs` asserts policed-layer coverage, so any regression here
        // fails the gate loudly. Keep the `(^|/)…(/|$)` anchoring.
        exclude: {
            path: [
                "node_modules",
                "\\.next",
                "(^|/)dist(/|$)",
                "(^|/)build(/|$)",
                "(^|/)coverage(/|$)",
                "(^|/)e2e(/|$)",
                "(^|/)brand-rework(/|$)",
                "(^|/)mobile(/|$)",
                "(^|/)extension-store(/|$)",
                "(^|/)scripts(/|$)",
            ],
        },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: "tsconfig.depcruise.json" },
        enhancedResolveOptions: {
            exportsFields: ["exports"],
            conditionNames: ["import", "require", "node", "default"],
        },
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
};
