#!/usr/bin/env bash
# panoply.test.sh — canary for scripts/panoply.sh.
#
# Why this exists: the kit's own rules require that any gate which pattern-matches must ship a
# fixture that carries every defect it claims to catch, plus a compliant one, and assert
# fail-then-pass. A single manual pass on a real repo cannot distinguish "compliant" from
# "detects nothing" — a check that always exits 0 looks identical to a perfect one.
#
# Asserts every state the doctor can report, by building a throwaway repo per case:
#   current(0) absent(10) partial(11) stale(12) placeholders(13) drifted(14) off(0) not-a-repo(0)
#
#   sh scripts/panoply.test.sh        (run from the kit root; used by CI)
set -u
# pipefail is a bash extension. CI invokes this gate as `sh scripts/panoply.test.sh`, where `sh` is
# dash and `set -o pipefail` is an illegal option that aborts the run before any check executes —
# a gate that cannot start reads as a broken repo rather than a broken check. Enable it only where
# the shell supports it (an `if`, not `A && B || C`, which older shellcheck flags as SC2015).
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

KIT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$KIT/scripts/panoply.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# This canary tests the KIT, and it builds its fixtures by copying the kit's own AGENTS.md, rule
# modules and sync-agents.sh. So it is only meaningful when $KIT really is the template. Deriving
# $KIT from $0 means running `sh scripts/panoply.test.sh` from ANY adopter silently makes that
# adopter the "kit" — its modules are already adapted (token-free), so `apply` seeds a repo with no
# placeholders, case 10's "post-apply is unadapted (13)" can never hold, the repo reports drift (14)
# instead, and the canary prints a FAIL that has nothing to do with the doctor. That is a false red
# in the one gate an adopter is told to run, which is worse than no gate: it trains people to ignore
# a failure. Detect the situation and SKIP loudly instead — a soft gate may skip, but never silently.
# PANOPLY_KIT_ROOT may point at a real template checkout to run it from elsewhere.
_is_template() {  # _is_template <dir> — same heuristic the doctor uses for self-detection
  [ -f "$1/scripts/init-template-repo.sh" ] && [ -f "$1/.agents/commands/adapt-agents-setup.md" ]
}
if [ -n "${PANOPLY_KIT_ROOT:-}" ] && _is_template "$PANOPLY_KIT_ROOT"; then
  KIT="$PANOPLY_KIT_ROOT"; DOC="$KIT/scripts/panoply.sh"
elif ! _is_template "$KIT"; then
  printf 'PANOPLY.TEST: SKIPPED — %s is not a kit template checkout.\n' "$KIT"
  printf '  This canary asserts the KIT doctor against fixtures built from the kit itself, so it\n'
  printf '  must run from the kit root (or with PANOPLY_KIT_ROOT=<kit checkout>).\n'
  printf '  In an ADOPTED repo, verify with:  sh scripts/panoply.sh check  &&  sh scripts/sync-agents.sh --check\n'
  exit 0
fi

pass=0; fail=0
_ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
_bad()  { fail=$((fail+1)); printf '  FAIL %s — %s\n' "$1" "$2"; }

# assert_exit <name> <expected-code> <dir>
assert_exit() {
  _n="$1"; _want="$2"; _d="$3"
  ( cd "$_d" && sh "$DOC" check ) >/dev/null 2>&1
  _got=$?
  if [ "$_got" = "$_want" ]; then _ok "$_n (exit $_got)"; else _bad "$_n" "want exit $_want, got $_got"; fi
}

_new_repo() {  # _new_repo <name> -> prints path
  _p="$WORK/$1"; mkdir -p "$_p"; ( cd "$_p" && git init -q . && printf 'x\n' > README.md \
    && git add -A && git -c user.email=t@t -c user.name=t commit -qm init ) >/dev/null 2>&1
  printf '%s' "$_p"
}

# A compliant adopter: the triad, no tokens, stamped, mirrors generated and in sync.
_make_adopted() {
  _p="$1"
  cp "$KIT/AGENTS.md" "$_p/AGENTS.md"
  sed -i 's/{{PROJECT_NAME}}/fixture/g' "$_p/AGENTS.md"
  mkdir -p "$_p/docs/agents" "$_p/.agents/rules" "$_p/scripts"
  cp "$KIT/docs/agents/roadmap.md" "$_p/docs/agents/roadmap.md" 2>/dev/null || printf '# roadmap\n' > "$_p/docs/agents/roadmap.md"
  # copy modules and strip every {{TOKEN}} so the fixture is genuinely adapted
  for _m in "$KIT"/.agents/rules/*.md; do
    b="$(basename "$_m")"; sed 's/{{[A-Z_][A-Z0-9_]*}}/fixture/g' "$_m" > "$_p/.agents/rules/$b"
  done
  cp "$KIT/scripts/sync-agents.sh" "$_p/scripts/sync-agents.sh"
  ( cd "$_p" && PANOPLY_SELF=0 sh scripts/sync-agents.sh ) >/dev/null 2>&1
  ( cd "$_p" && sh "$DOC" stamp ) >/dev/null 2>&1
}

echo "panoply.test.sh — kit $("$DOC" version)"

# --- case 1: absent ----------------------------------------------------------------------------
R="$(_new_repo absent)";            assert_exit "absent repo"            10 "$R"
# --- case 2: partial (AGENTS.md only) ----------------------------------------------------------
R="$(_new_repo partial)"; cp "$KIT/AGENTS.md" "$R/AGENTS.md"; sed -i 's/{{PROJECT_NAME}}/p/g' "$R/AGENTS.md"
                                    assert_exit "half-applied repo"      11 "$R"
# --- case 3: unadapted (triad present, tokens left) --------------------------------------------
R="$(_new_repo unadapted)"; _make_adopted "$R"
sed -i 's/fixture/{{PROJECT_NAME}}/' "$R/AGENTS.md"          # re-introduce one token
                                    assert_exit "unfilled placeholders"  13 "$R"
# --- case 4: stale (adapted, no stamp) ---------------------------------------------------------
R="$(_new_repo stale)"; _make_adopted "$R"; rm -f "$R/.panoply-version"
                                    assert_exit "stale (no stamp)"       12 "$R"
# --- case 5: stale (stamp behind) --------------------------------------------------------------
R="$(_new_repo stale2)"; _make_adopted "$R"
sed -i 's/^kit_version: .*/kit_version: v0.0.1/' "$R/.panoply-version"
                                    assert_exit "stale (old version)"    12 "$R"
# --- case 6: drifted mirrors -------------------------------------------------------------------
R="$(_new_repo drifted)"; _make_adopted "$R"
# Generate at least one tool-native mirror so --check has something to compare, then corrupt it.
( cd "$R" && PANOPLY_SELF=0 sh scripts/sync-agents.sh ) >/dev/null 2>&1
printf '\nhand edit that bypasses the generator\n' >> "$R/CONVENTIONS.md"
                                    assert_exit "drifted mirrors"        14 "$R"
# --- case 7: current ---------------------------------------------------------------------------
R="$(_new_repo current)"; _make_adopted "$R"
                                    assert_exit "compliant adopter"       0 "$R"
# --- case 8: escape hatch ----------------------------------------------------------------------
R="$(_new_repo off)"; ( cd "$R" && PANOPLY_OFF=1 sh "$DOC" check ) >/dev/null 2>&1
_off=$?
# Prefer an if over `A && B || C`: SC2015 (shellcheck <= 0.11) fires on the chain, and CI runs an
# older shellcheck than this box does, so the chain passes locally and fails the PR.
if [ "$_off" = 0 ]; then _ok "PANOPLY_OFF escape hatch (exit 0)"; else _bad "PANOPLY_OFF" "got $_off"; fi
# --- case 9: not a git tree must never block ---------------------------------------------------
R="$WORK/nogit"; mkdir -p "$R";     assert_exit "non-git dir is not blocked" 0 "$R"

# --- case 10: apply must reach a state the agent can FINISH -------------------------------------
# Why this case exists: apply originally seeded the spine and the rule modules but never AGENTS.md,
# so every adoption stalled at exit 11 ("half-applied — missing AGENTS.md") with no file to fill.
# apply could not reach a state an agent could complete from, which made the runbook a dead end.
# The check here is the CONTRACT, not the mechanism: after apply, the repo must be reportable as
# unadapted (13) — i.e. hub present with tokens to fill — and must never be back at 11.
R="$(_new_repo applies)"
( cd "$R" && sh "$DOC" apply ) >/dev/null 2>&1
_apply_rc=$?
if [ "$_apply_rc" = 0 ]; then _ok "apply exits 0"; else _bad "apply exits 0" "got $_apply_rc"; fi
if [ -f "$R/AGENTS.md" ]; then _ok "apply seeds an AGENTS.md hub"; else _bad "apply seeds an AGENTS.md hub" "absent"; fi
assert_exit "post-apply is unadapted, not half-applied" 13 "$R"
# A repo with its OWN hub must be left untouched by apply (the judgement half merges it).
R="$(_new_repo ownhub)"
printf '# my own hub\nno tokens here\n' > "$R/AGENTS.md"
( cd "$R" && sh "$DOC" apply ) >/dev/null 2>&1
if grep -q 'my own hub' "$R/AGENTS.md" && ! grep -q '{{\|PANOPLY:RULES' "$R/AGENTS.md"; then
  _ok "apply never clobbers an existing AGENTS.md"
else
  _bad "apply never clobbers an existing AGENTS.md" "hub was replaced by the kit template"
fi

# --- case 11: the COPY-OF-THE-DOCTOR must resolve the KIT's version, not the adopter's -----------
# Why this case exists: `apply` copies panoply.sh into the adopted repo so it can self-check. Once
# copied, `$0` resolves to the ADOPTER, so version resolution read the adopter's own git tags. A
# repo with any unrelated tag (e.g. its own v1.0.0 product release) then never matched the kit's
# stamp and reported "stale" forever — an always-red gate on a perfectly compliant repo.
R="$(_new_repo copydoctor)"
( cd "$R" && sh "$DOC" apply ) >/dev/null 2>&1
( cd "$R" && git tag v9.9.9-product-release ) >/dev/null 2>&1   # an unrelated adopter tag
_v_local="$( cd "$R" && sh scripts/panoply.sh version 2>/dev/null )"
_v_kit="$("$DOC" version)"
if [ "$_v_local" = "$_v_kit" ]; then
  _ok "copied doctor reports the kit version ($_v_local), not the adopter's tag"
else
  _bad "copied doctor reports the kit version" "local gave '$_v_local', kit is '$_v_kit'"
fi

# --- case 12: apply must NEVER silently clobber a locally-edited script -------------------------
# Why: nexalog's check-docs.sh carries a conflict-marker sweep the kit template lacks. apply cp'd the
# template over it with no NOTE at all — an unreported capability regression, and the same hazard for
# sync-agents.sh / check-plan-home.sh (any repo-local edit). Rule modules already reported divergence;
# scripts did not. The contract is now: install when absent, KEEP and report when it differs, and
# replace only under an explicit --force-scripts.
R="$(_new_repo scriptclobber)"
( cd "$R" && sh "$DOC" apply ) >/dev/null 2>&1
printf '\n# LOCAL CUSTOMIZATION MARKER\n' >> "$R/scripts/check-docs.sh"
_out="$( cd "$R" && sh "$DOC" apply 2>&1 )"
if grep -q 'LOCAL CUSTOMIZATION MARKER' "$R/scripts/check-docs.sh"; then
  _ok "apply preserves a locally-edited script"
else
  _bad "apply preserves a locally-edited script" "the local edit was clobbered silently"
fi
if printf '%s' "$_out" | grep -q 'KEPT scripts/check-docs.sh'; then
  _ok "apply reports the kept script (not silent)"
else
  _bad "apply reports the kept script" "no KEPT note in apply output"
fi
# and the explicit opt-in must actually replace it
( cd "$R" && sh "$DOC" apply --force-scripts ) >/dev/null 2>&1
if grep -q 'LOCAL CUSTOMIZATION MARKER' "$R/scripts/check-docs.sh"; then
  _bad "--force-scripts replaces the script" "marker survived the forced refresh"
else
  _ok "--force-scripts replaces the script"
fi

echo
if [ "$fail" = 0 ]; then printf 'PANOPLY.TEST: all green (%d checks)\n' "$pass"; exit 0; fi
printf 'PANOPLY.TEST: FAILED (%d ok, %d failed)\n' "$pass" "$fail"; exit 1
