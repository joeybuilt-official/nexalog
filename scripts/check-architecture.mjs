// SPDX-License-Identifier: MIT
// check-architecture.mjs — `pnpm depcruise`, wrapped so it can never pass vacuously.
//
// WHY THIS FILE EXISTS (the defect it closes)
// -------------------------------------------
// dependency-cruiser degrades SILENTLY when it cannot build a TypeScript project:
//
//   $ mv node_modules/typescript /tmp/ts          # root typescript removed
//   $ pnpm depcruise
//   ✔ no dependency violations found (3 modules, 0 dependencies cruised)   # exit 0
//
// Three modules instead of ~274, no violations, exit 0 — a fully green gate that cruised
// nothing. Nothing in the repo asserted how much of the codebase the cruise actually saw, so
// the failure mode was "green gate, zero coverage, no signal". The same class of silent loss
// happens when `tsconfig.depcruise.json` is missing/unresolvable, when the cruise roots are
// wrong, or when a path-anchored `options.exclude.path` pattern accidentally matches a source
// file (e.g. an unanchored `build` matching `lib/export/build-archive.ts`).
//
// This wrapper runs the same cruise, renders the same human-readable violation report, and then
// ASSERTS how much of the tracked source tree the cruise covered. If the cruise covered less
// than it must, the gate fails loudly with the counts and the likely causes — instead of
// reporting success.
//
// WHAT IT ASSERTS (see AGENTS.md / .claude/rules/clean-architecture.md → Review checklist 1)
//   1. `typescript` resolves from the repo root, and `tsconfig.depcruise.json` exists.
//      These are the two inputs whose absence makes depcruise degrade silently.
//   2. Overall coverage: cruised tracked in-scope sources ≥ MIN_COVERAGE (90%) of all tracked
//      in-scope sources (`git ls-files apps/web packages` → .ts/.tsx, minus the config's own
//      excludes). A self-calibrating ratio, never an exact module count: a healthy cruise
//      reports a slightly different module count across environments (274 locally vs 273 in CI
//      on the same commit — the delta is the gitignored `apps/web/next-env.d.ts`, which is
//      absent in a fresh checkout), so an exact constant would make the gate itself flaky.
//   3. Policed-layer coverage: EVERY tracked source file the `error` rules can act on —
//      `packages/core`, `packages/adapters`, `apps/web/lib` — must have been cruised. This is
//      100% by construction, checked against `git ls-files` WITHOUT applying the config's
//      excludes, so a broadened `options.exclude.path` cannot quietly retire files from the
//      rules' reach. This is the assertion that catches partial silent loss (the failure mode a
//      percentage alone tolerates).
//   4. Key areas present: at least one cruised module from `packages/core`, `packages/adapters`,
//      and `apps/web` — a direct check that the cruise roots resolve at all.
//
// GATE SEMANTICS ARE UNCHANGED. The violation report and exit code come from dependency-cruiser's
// own `err` reporter (`format()`), byte-identical to a bare `depcruise` run and with the same
// non-zero exit on `error` severity. Real violations still fail; warnings still don't.
//
// POSIX-friendly, no runtime deps beyond depcruise's own. Node 22 (CI) / 26 (local).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps/web", "packages"]; // cruise roots — same args the old `pnpm depcruise` passed
const CONFIG = ".dependency-cruiser.cjs";
const TSCONFIG = "tsconfig.depcruise.json";
const DEPCRUISE_BIN = path.join(ROOT, "node_modules", ".bin", "depcruise");

/** Minimum fraction of tracked in-scope sources the cruise must have seen. */
const MIN_COVERAGE = 0.9;
/** Below this, source discovery itself is broken (no git, wrong roots) — fail rather than divide by ~0. */
const MIN_EXPECTED_SOURCES = 50;
/** Path prefixes whose tracked sources the `error` rules act on: all must be cruised. */
const POLICED_PREFIXES = ["packages/core/", "packages/adapters/", "apps/web/lib/"];
/** Cruise roots that must each contribute at least one module. */
const KEY_AREAS = ["packages/core/", "packages/adapters/", "apps/web/"];
/**
 * The one area that is legitimately outside the audit scope: Playwright specs, excluded by
 * `tsconfig.depcruise.json` → `exclude` and not policed by any rule. Deliberate and explicit —
 * everything else tracked under the cruise roots must be cruised.
 *
 * The denominator is deliberately NOT derived from `.dependency-cruiser.cjs` →
 * `options.exclude.path`: that config is the thing being policed, so letting it define what
 * counts as "in scope" would let a broadened exclude shrink numerator and denominator together
 * and keep the ratio at 100% — the same silent-coverage defect in a subtler form. Tracked
 * sources are the source tree (build artifacts are untracked, so git already excludes them).
 */
const OUT_OF_SCOPE = [/^apps\/web\/e2e\//];
/** Observed on main 2026-09-25, for context in the counts line. Not asserted — see the header. */
const HEALTHY_BASELINE = { modules: 274, dependencies: 454 };

const problems = [];
const fail = (headline, details) => problems.push({ headline, details });

// ---------------------------------------------------------------------------------------------
// Preconditions: the two inputs whose absence degrades depcruise silently.
// ---------------------------------------------------------------------------------------------
const require = createRequire(path.join(ROOT, "package.json"));

let resolveError = null;
try {
  require.resolve("typescript");
} catch (error) {
  fail("root `typescript` does not resolve from the repo root", [
    "dependency-cruiser cannot build a TS project without it, and then cruises ~3 JS modules",
    "while reporting success — this is the silent no-op this guard exists to catch.",
    `resolve failed: ${error.code ?? error.message}`,
  ]);
}
// dependency-cruiser is ESM-only, so it has no CJS `require.resolve` entry point. Check the
// installed package directory instead — the dynamic `import("dependency-cruiser")` below is the
// real consumer, and a missing install is what this precondition is guarding against.
if (!existsSync(path.join(ROOT, "node_modules", "dependency-cruiser", "package.json"))) {
  fail("`dependency-cruiser` is not installed at the repo root", [
    "it is a root devDependency and the cruise cannot run without it.",
    "install the root devDependencies: pnpm install --frozen-lockfile",
  ]);
}
if (!existsSync(path.join(ROOT, TSCONFIG))) {
  fail(`${TSCONFIG} is missing`, [
    "the monorepo needs ONE TS project spanning apps/ + packages/ for `@/*` aliases and",
    "workspace imports to resolve; without it depcruise silently cruises almost nothing.",
  ]);
}
if (!existsSync(DEPCRUISE_BIN)) {
  fail(`depcruise binary not found at ${path.relative(ROOT, DEPCRUISE_BIN)}`, [
    "install dependencies first: pnpm install --frozen-lockfile",
  ]);
}

// ---------------------------------------------------------------------------------------------
// The cruise — identical invocation to the old script, asking for machine-readable output.
// ---------------------------------------------------------------------------------------------
let cruise = null;
let cruiseStderr = "";
if (problems.length === 0) {
  const result = spawnSync(
    DEPCRUISE_BIN,
    [...ROOTS, "--config", CONFIG, "--output-type", "json"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  cruiseStderr = result.stderr ?? "";
  const stdout = result.stdout ?? "";
  try {
    cruise = JSON.parse(stdout);
  } catch {
    fail(`depcruise did not produce a cruise result (exit ${result.status})`, [
      cruiseStderr.trim(),
      "the config or tsconfig could not be read — see the causes listed below.",
    ].filter(Boolean));
  }
}

// ---------------------------------------------------------------------------------------------
// Render the violation report and take the exit code from dependency-cruiser itself, so the CI
// log and the pass/fail semantics are exactly what a bare `depcruise` run produced.
// ---------------------------------------------------------------------------------------------
let violationExitCode = 0;
if (cruise) {
  const cfg = require(path.join(ROOT, CONFIG));
  const { format } = await import("dependency-cruiser");
  const rendered = await format(cruise, {
    outputType: "err",
    reporterOptions: cfg.options?.reporterOptions ?? {},
  });
  const text = String(rendered.output ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  if (text.trim()) process.stdout.write(`${text.replace(/\s+$/, "")}\n`);
  violationExitCode = Number(rendered.exitCode) || 0;

  // ---- coverage accounting ----
  const excludePatterns = [].concat(cfg.options?.exclude?.path ?? []);

  const trackedSources = execFileSync("git", ["ls-files", ...ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file));

  const inScope = trackedSources.filter((file) => !OUT_OF_SCOPE.some((re) => re.test(file)));
  const cruised = new Set((cruise.modules ?? []).map((module) => module.source));
  const coveredInScope = inScope.filter((file) => cruised.has(file));
  const missedInScope = inScope.filter((file) => !cruised.has(file));

  const expectedPoliced = trackedSources.filter((file) =>
    POLICED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  const coveredPoliced = expectedPoliced.filter((file) => cruised.has(file));
  const missingPoliced = expectedPoliced.filter((file) => !cruised.has(file));

  // Files the config's own exclude patterns retire from the cruise. Reported so a broadened
  // exclude is visible in the log even when the ratio still clears the floor.
  const excludeRe = excludePatterns.length > 0 ? new RegExp(excludePatterns.join("|")) : null;
  const excludeRetired = excludeRe ? inScope.filter((file) => excludeRe.test(file)) : [];

  const moduleCount = cruise.summary?.totalCruised ?? (cruise.modules ?? []).length;
  const dependencyCount = cruise.summary?.totalDependenciesCruised ?? 0;
  const ratio = inScope.length > 0 ? coveredInScope.length / inScope.length : 0;

  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  console.log(
    `arch-gate: ${moduleCount} modules / ${dependencyCount} dependencies cruised · ` +
      `tracked sources covered ${coveredInScope.length}/${inScope.length} (${pct(ratio)}) · ` +
      `policed layers covered ${coveredPoliced.length}/${expectedPoliced.length} · ` +
      `retired by exclude.path ${excludeRetired.length} · ` +
      `errors ${cruise.summary?.error ?? 0} · warnings ${cruise.summary?.warn ?? 0} · ` +
      `baseline ${HEALTHY_BASELINE.modules}/${HEALTHY_BASELINE.dependencies}`,
  );

  if (inScope.length < MIN_EXPECTED_SOURCES) {
    fail(`only ${inScope.length} tracked sources discovered (expected ≥ ${MIN_EXPECTED_SOURCES})`, [
      "source discovery is broken, so a coverage ratio would be meaningless:",
      "  - is this a git checkout? `git ls-files` must list the sources",
      `  - do the cruise roots still exist (${ROOTS.join(", ")})?`,
      `  - is \`options.exclude.path\` in ${CONFIG} excluding the source tree?`,
    ]);
  } else if (ratio < MIN_COVERAGE) {
    fail(
      `cruise coverage ${pct(ratio)} is below the ${pct(MIN_COVERAGE)} floor ` +
        `(${coveredInScope.length}/${inScope.length} tracked sources cruised)`,
      [
        "a degraded cruise reports success while seeing almost none of the codebase.",
        ...missedInScope.slice(0, 20).map((file) => `  - not cruised: ${file}`),
        missedInScope.length > 20 ? `  - … and ${missedInScope.length - 20} more` : null,
      ].filter(Boolean),
    );
  }

  if (missingPoliced.length > 0) {
    fail(
      `${missingPoliced.length} policed source file(s) were NOT cruised — ` +
        `the architecture rules silently do not apply to them`,
      missingPoliced.slice(0, 20).map((file) => `  - ${file}`),
    );
  }

  const absentAreas = KEY_AREAS.filter(
    (area) => !(cruise.modules ?? []).some((module) => module.source.startsWith(area)),
  );
  if (absentAreas.length > 0) {
    fail("no cruised module found for key area(s)", absentAreas.map((area) => `  - ${area}`));
  }
}

// ---------------------------------------------------------------------------------------------
// Verdict.
// ---------------------------------------------------------------------------------------------
if (problems.length > 0) {
  console.error("\narch-gate: FAIL — the architecture gate could not verify its own coverage.\n");
  for (const { headline, details } of problems) {
    console.error(`  ✖ ${headline}`);
    for (const line of details ?? []) console.error(`      ${line}`);
  }
  console.error(
    [
      "",
      "  likely causes, in order of likelihood:",
      "    1. root `typescript` missing — run `pnpm install --frozen-lockfile` at the repo root.",
      `       Without it depcruise cruises ~3 JS modules and reports "no violations".`,
      `    2. \`${TSCONFIG}\` missing, renamed, or not resolving — the monorepo needs one TS project.`,
      `    3. cruise roots wrong (\`${ROOTS.join(" ")}\`) or ${CONFIG} → \`options.exclude.path\``,
      "       too broad: every exclude entry is an unanchored regex matched against the whole",
      "       path, so `build` also excludes `lib/export/build-archive.ts`. Anchor with (^|/)…(/|$).",
      "",
      "  this guard is documented in .claude/rules/clean-architecture.md → \"Known gaps\".",
      "",
    ].join("\n"),
  );
}

if (violationExitCode !== 0) process.exit(violationExitCode);
if (problems.length > 0) process.exit(1);
console.log("arch-gate: OK — violation report above; coverage asserted.");
