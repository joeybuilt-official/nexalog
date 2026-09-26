#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# self-test-arch-gate.sh — DEV-ONLY. NEVER wire this into CI.
#
# Proves `pnpm depcruise` (scripts/check-architecture.mjs) can no longer pass vacuously, by
# injecting each silent-failure mode it guards against and asserting the gate's exit code.
# Every probe is created and removed under a single trap, so a failed assertion cannot leave
# residue in the tree. Run it by hand after changing the gate, the config, or the tsconfig:
#
#   sh scripts/self-test-arch-gate.sh
#
# Why it must never run in CI: it deliberately mutates the working tree (moves node_modules/typescript,
# writes throwaway source files) and asserts non-zero exits. CI should run the gate itself, not a
# harness that pokes holes in it. The manual transcripts in the PR body are the evidence; this
# script is the repeatable version of them.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GATE="pnpm depcruise"
SCRATCH="$(mktemp -d)"
TS_DIR="$ROOT/node_modules/typescript"
TS_HIDDEN="$SCRATCH/typescript"
PROBES="packages/core/__arch_probe.ts apps/web/lib/__arch_probe.ts"
TSCONFIG_HIDDEN="$SCRATCH/tsconfig.depcruise.json"

pass=0
fail=0

cleanup() {
  # Every mutation this script can make, undone unconditionally.
  for p in $PROBES; do rm -f "$p"; done
  [ -d "$TS_HIDDEN" ] && [ ! -e "$TS_DIR" ] && mv "$TS_HIDDEN" "$TS_DIR" || true
  [ -f "$TSCONFIG_HIDDEN" ] && [ ! -e "$ROOT/tsconfig.depcruise.json" ] && \
    mv "$TSCONFIG_HIDDEN" "$ROOT/tsconfig.depcruise.json" || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

# run_gate — run the gate, print its exit code and a short tail for context.
# errexit stays OFF inside the helpers: they exist to observe non-zero exits, and re-arming
# errexit before returning non-zero would abort the whole self-test on the first probe.
run_gate() {
  _out="$SCRATCH/gate.out"
  $GATE > "$_out" 2>&1
  _code=$?
  echo "    exit=$_code"
  { grep -E 'arch-gate:|dependency violations|✖' "$_out" | head -4 | sed 's/^/    | /'; } || true
  return $_code
}

expect_fail() { # expect_fail <label>
  code=0
  run_gate || code=$?
  if [ "$code" -eq 0 ]; then
    echo "FAIL: $1 — gate exited 0 (should have failed)"
    fail=$((fail + 1))
  else
    echo "ok:   $1 — gate exited $code"
    pass=$((pass + 1))
  fi
}

expect_pass() { # expect_pass <label>
  code=0
  run_gate || code=$?
  if [ "$code" -eq 0 ]; then
    echo "ok:   $1 — gate exited 0"
    pass=$((pass + 1))
  else
    echo "FAIL: $1 — gate exited $code (should have passed)"
    fail=$((fail + 1))
  fi
}

echo "arch-gate self-test — every probe is reverted on exit (trap)"
echo

echo "1/6 baseline: the unmodified tree passes"
expect_pass "baseline clean"
echo

echo "2/6 silent no-op: root \`typescript\` hidden (FINDING 1 — ~3 modules cruised, exit 0 before)"
echo "    bare depcruise first, to show the OLD behavior:"
if [ -d "$TS_DIR" ]; then
  mv "$TS_DIR" "$TS_HIDDEN"
  set +e
  node_modules/.bin/depcruise apps/web packages --config .dependency-cruiser.cjs 2>&1 | tail -1 | sed 's/^/    | /'
  set -e
  expect_fail "root typescript hidden"
  mv "$TS_HIDDEN" "$TS_DIR"
else
  echo "    SKIP: node_modules/typescript not found (nothing to hide)"
fi
echo

echo "3/6 silent no-op: tsconfig.depcruise.json missing"
if [ -f tsconfig.depcruise.json ]; then
  mv tsconfig.depcruise.json "$TSCONFIG_HIDDEN"
  expect_fail "tsconfig.depcruise.json missing"
  mv "$TSCONFIG_HIDDEN" tsconfig.depcruise.json
else
  echo "    SKIP: tsconfig.depcruise.json not found"
fi
echo

echo "4/6 core purity: unresolved bare specifier in packages/core (FINDING 2 — classified 'unknown')"
cat > packages/core/__arch_probe.ts <<'PROBE'
import { z } from "zod";
export const p = z;
PROBE
expect_fail "zod import in packages/core"
rm -f packages/core/__arch_probe.ts
echo

echo "5/6 lib-must-not-import-UI: lib/ slice importing a component"
cat > apps/web/lib/__arch_probe.ts <<'PROBE'
import { ThemeToggle } from "@/components/theme-toggle";
export const b = ThemeToggle;
PROBE
expect_fail "apps/web/lib importing components/"
rm -f apps/web/lib/__arch_probe.ts
echo

echo "6/6 restored: the tree passes again"
expect_pass "clean after probes"
echo

echo "arch-gate self-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
