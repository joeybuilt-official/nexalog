#!/usr/bin/env sh
# panoply.sh — the Panoply kit's machine surface: detect, report, and seed.
#
# Why this exists: the kit could only be applied by a Claude Code slash-command prompt
# (`.claude/commands/adapt-claude-setup.md`), and nothing recorded WHICH kit version a repo
# received. So "not applied" and "applied in July" were indistinguishable to every agent that was
# not Claude, and kit drift was invisible. This script is the check/apply entry point any agent or
# CI can run: Hermes, Codex, Cursor, a cron, a pre-commit hook.
#
#   sh scripts/panoply.sh check [--quiet]   exit 0 = current, non-zero = action needed
#   sh scripts/panoply.sh apply [--yes]     seed/refresh the DETERMINISTIC half of the kit
#   sh scripts/panoply.sh stamp             write/refresh .panoply-version only
#   sh scripts/panoply.sh version           print this kit's version
#
# Exit codes (check): 0 current · 10 absent · 11 partial · 12 stale · 13 placeholders left · 14 mirrors drifted
# Env: PANOPLY_OFF=1 disables the check entirely (adopting repo mid-migration).

set -eu

# ---------------------------------------------------------------- version ----
# The kit's version is the KIT SOURCE's own semver tag — resolved from this script's location, never
# from the repo under inspection (a consumer repo's tags are unrelated, and resolving them silently
# reports another project's version). Falls back to the latest tag, then "unreleased".
_kit_root() { cd "$(dirname "$0")/.." && pwd; }

# A canonical kit clone, used when this script has been COPIED into an adopted repo.
_canonical_kit_root() {
  for _c in "${PANOPLY_KIT_ROOT:-}" "${HOME:-}/.panoply" "${HOME:-}/.cache/panoply" "${HOME:-}/panoply" "/opt/data/panoply-kit"; do
    [ -n "$_c" ] || continue
    if [ -f "$_c/scripts/panoply.sh" ]; then printf '%s' "$_c"; return 0; fi
  done
  return 1
}

# True when this script is a COPY living inside an adopted repo rather than the kit source itself.
# `apply` copies the doctor into the repo so the repo can self-check; the tell is a stamp sitting
# next to us (the kit source never carries one — it IS the source).
_is_copied_doctor() { [ -f "$(_kit_root)/$(printf '.panoply-version')" ]; }

# The repo whose tags define the KIT's version. From a copied doctor, `$0`'s directory is the
# ADOPTER, whose tags are unrelated to the kit's: resolving from it made a compliant repo mismatch
# its own product tag against the stamp and report "stale" forever — an always-red gate. The
# canonical clone is the only correct source; when it is not present (a CI runner, a fresh machine)
# we must NOT fall back to the adopter's tags, so the caller uses the stamp instead.
_kit_source_root() { _canonical_kit_root; }

_kit_version() {
  if _is_copied_doctor; then
    _r="$(_kit_source_root || true)"
    if [ -n "$_r" ]; then
      v="$(git -C "$_r" describe --tags --abbrev=0 2>/dev/null || true)"
      [ -n "$v" ] || v="$(git -C "$_r" tag --sort=-v:refname 2>/dev/null | head -1 || true)"
      [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    fi
    # No canonical clone: believe the stamp. Never the adopter's own tags — that is the bug.
    v="$(sed -n 's/^kit_version:[[:space:]]*//p' "$(_kit_root)/$(printf '.panoply-version')" 2>/dev/null | head -1)"
    [ -n "$v" ] || v="unreleased"
    printf '%s' "$v"
    return 0
  fi
  _r="$(_kit_root)"
  v="$(git -C "$_r" describe --tags --abbrev=0 2>/dev/null || true)"
  [ -n "$v" ] || v="$(git -C "$_r" tag --sort=-v:refname 2>/dev/null | head -1 || true)"
  [ -n "$v" ] || v="unreleased"
  printf '%s' "$v"
}

_kit_sha() {
  _r="$(_kit_source_root || true)"
  if [ -n "$_r" ]; then git -C "$_r" rev-parse --short HEAD 2>/dev/null && return 0; fi
  if _is_copied_doctor; then
    sed -n 's/^kit_sha:[[:space:]]*//p' "$(_kit_root)/$(printf '.panoply-version')" 2>/dev/null | head -1
    return 0
  fi
  printf 'unknown'
}

# ---------------------------------------------------------------- markers ----
# The triad. Absent = never applied. Partial = a half-applied kit, which the kit's own docs call out
# as the failure mode that "looks like a doc bug" (dead refs, missing spine).
_REQUIRED_AGENTS="AGENTS.md"
_REQUIRED_SPINE="docs/claude/roadmap.md"
_REQUIRED_RULES=".claude/rules/clean-architecture.md"
_MARKER_MIRROR="MIRROR:start"
_MARKER_RULES="PANOPLY:RULES:BEGIN"

_stamp_file() { printf '.panoply-version'; }

# ---------------------------------------------------------------- inspect ----
# Reads the repo in the CWD. Prints findings to stderr, and a machine-readable line to stdout.
# Emits: STATUS<tab>detail
_inspect() {
  _status="current"
  _reason=""

  for _f in "$_REQUIRED_AGENTS" "$_REQUIRED_SPINE" "$_REQUIRED_RULES"; do
    if [ ! -f "$_f" ]; then
      _status="partial"
      _reason="missing $_f"
      # Nothing at all present => absent, not partial.
      if [ ! -f "$_REQUIRED_AGENTS" ] && [ ! -d docs/claude ] && [ ! -d .claude/rules ]; then
        _status="absent"
        _reason="no kit markers found"
      fi
      break
    fi
  done

  # Placeholders surviving anywhere in the kit surface => the kit was copied but never adapted.
  # Only ADOPTED repos can be "unadapted": the template repo itself is legitimately full of tokens,
  # so it is excluded. Without this exclusion the kit reports itself broken on every run, which is
  # exactly the kind of always-red gate people learn to ignore.
  # Self-detection: only the template repo ships scripts/init-template-repo.sh (it is the script that
  # published the template). PANOPLY_SELF=1 forces the exclusion; PANOPLY_SELF=0 forces the check.
  _self=0
  case "${PANOPLY_SELF:-auto}" in
    1) _self=1 ;;
    0) _self=0 ;;
    *)
      # NOTE: an `A && B && C=1` chain here would return non-zero when the tests fail, and `set -e`
      # would abort the whole check on a repo that merely is not the template. Use an if.
      if [ -f scripts/init-template-repo.sh ] && [ -f .claude/commands/adapt-claude-setup.md ]; then
        _self=1
      fi
      ;;
  esac
  if [ "$_status" = "current" ] && [ "$_self" != "1" ]; then
    # Only ADAPT-TIME tokens count. The kit's docs legitimately discuss its own convention using the
    # metasyntax ({{DOUBLE_BRACES}}, {{TOKEN}}, {{PROJECT_NAME}} in prose), so matching any run of
    # capital letters flags every correctly-adopted repo as unadapted — the always-red failure the
    # canary caught. An unfilled token is a NAME-like placeholder; prose metasyntax is not.
    _ph="$(grep -rlE '\{\{(PROJECT_NAME|ONE_LINE_DESCRIPTION|CORE_PILLARS|DEFAULT_BRANCH|PKG_MANAGER|LANGUAGE_RUNTIME|INSTALL_CMD|DEV_CMD|BUILD_CMD|TEST_CMD|LINT_CMD|FORMAT_CMD|TYPECHECK_CMD|COVERAGE_CHECK_CMD|CLIENT_STACK|SERVER_STACK|DATABASE_STACK|MONOREPO_LAYOUT|PROJECT_STRUCTURE|TEST_DIR|ENDPOINT_SRC_DIR|DOMAIN_DIR|USECASE_DIR|ADAPTER_DIR|INFRA_DIR|UI_PRIMITIVES_DIR|DOMAIN_COMPONENTS_DIR|PAGES_DIR|SCHEMA_FILE|MIGRATE_GEN_CMD|MIGRATE_APPLY_CMD|EXPORT_STYLE|FILE_NAMING|IMPORT_ALIAS|SHARED_CONSTANTS_PATH|API_WRAPPER|DATA_ACCESS_LAYER|DATA_FETCH_LIB|UI_FRAMEWORK|STYLING_SYSTEM|ICON_LIBRARY|ICON_SIZE|DESIGN_REFERENCE|AESTHETIC_FAMILY|CHROME_WEIGHT|PALETTE_STRATEGY|DENSITY|MOTION_INTENSITY|DEFAULT_TEXT_SIZE|SECTION_HEADER|FIELD_LABEL|FIELD_VALUE|SECTION_PADDING|ELEMENT_GAP|BORDER_TREATMENT|ARCH_CHECK_CMD|MIGRATE_[A-Z_]+|[A-Z_]*_CMD)\}\}' \
      AGENTS.md CLAUDE.md docs/claude .claude/rules 2>/dev/null | head -5 || true)"
    if [ -n "$_ph" ]; then
      _status="placeholders"
      _reason="unfilled adapt tokens in: $(printf '%s' "$_ph" | tr '\n' ' ')"
    fi
  fi

  # Stamp missing or behind the kit version => stale (applied, but not the current kit).
  # The template repo itself carries no stamp: it IS the source, not an adopter.
  if [ "$_status" = "current" ] && [ "$_self" != "1" ]; then
    _want="$(_kit_version)"
    if [ ! -f "$(_stamp_file)" ]; then
      _status="stale"
      _reason="no $(_stamp_file) stamp (applied before stamping existed, or hand-copied)"
    else
      _got="$(sed -n 's/^kit_version:[[:space:]]*//p' "$(_stamp_file)" | head -1)"
      if [ -n "$_got" ] && [ "$_got" != "$_want" ]; then
        _status="stale"
        _reason="stamp says $_got, kit is $_want"
      fi
    fi
  fi

  # Mirrors drifted from their modules => the generated files no longer match the rule bodies.
  if [ "$_status" = "current" ] && [ -f scripts/sync-agents.sh ]; then
    if ! sh scripts/sync-agents.sh --check >/dev/null 2>&1; then
      _status="drifted"
      _reason="generated mirrors out of sync with .claude/rules (run: sh scripts/sync-agents.sh)"
    fi
  fi

  printf '%s\t%s\n' "$_status" "$_reason"
}

# ---------------------------------------------------------------- commands ----
cmd_version() { _kit_version; printf '\n'; }

cmd_stamp() {
  _v="$(_kit_version)"; _s="$(_kit_sha)"
  {
    printf '# panoply kit stamp — written by scripts/panoply.sh (do not hand-edit)\n'
    printf 'kit_version: %s\n' "$_v"
    printf 'kit_sha: %s\n' "$_s"
    printf 'applied_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'applied_by: %s\n' "${PANOPLY_APPLIED_BY:-unknown-agent}"
  } > "$(_stamp_file)"
  printf 'stamped %s at %s (%s)\n' "$(_stamp_file)" "$_v" "$_s"
}

cmd_check() {
  _quiet=0
  for a in "$@"; do [ "$a" = "--quiet" ] && _quiet=1; done

  if [ "${PANOPLY_OFF:-0}" = "1" ]; then
    printf 'panoply: OFF (PANOPLY_OFF=1) — check skipped\n' >&2
    exit 0
  fi
  if [ ! -d .git ]; then
    printf 'panoply: not a git working tree (nothing to check)\n' >&2
    exit 0
  fi

  _out="$(_inspect)"
  _st="$(printf '%s' "$_out" | cut -f1)"
  _why="$(printf '%s' "$_out" | cut -f2)"

  _ver="$(_kit_version)"
  case "$_st" in
    current)
      [ "$_quiet" = 1 ] || printf 'panoply: OK — kit %s applied and current\n' "$_ver"
      exit 0 ;;
    absent)
      printf 'panoply: NOT APPLIED — %s (kit %s available)\n' "$_why" "$_ver" >&2
      printf 'panoply: adopt it:  sh scripts/panoply.sh apply   then complete the agent checklist in the kit README\n' >&2
      exit 10 ;;
    partial)
      printf 'panoply: HALF-APPLIED — %s\n' "$_why" >&2
      printf 'panoply: a half-applied kit fails its own doc gate and looks like a doc bug. Finish it:  sh scripts/panoply.sh apply\n' >&2
      exit 11 ;;
    stale)
      printf 'panoply: STALE — %s\n' "$_why" >&2
      printf 'panoply: read the kit CHANGELOG for what changed, then re-adopt/refresh.\n' >&2
      exit 12 ;;
    placeholders)
      printf 'panoply: UNADAPTED — %s\n' "$_why" >&2
      printf 'panoply: the kit was copied but never adapted; fill or delete every {{TOKEN}}.\n' >&2
      exit 13 ;;
    drifted)
      printf 'panoply: MIRRORS DRIFTED — %s\n' "$_why" >&2
      exit 14 ;;
    *)
      printf 'panoply: unknown state %s\n' "$_st" >&2; exit 1 ;;
  esac
}

# apply: the DETERMINISTIC half only. Everything that requires judgement (filling {{TOKEN}}s,
# pruning MODULE: blocks, merging a pre-existing CLAUDE.md/AGENTS.md) is emitted as a checklist —
# a script must never guess a command table or a layer map, and the kit's own applier forbids it.
cmd_apply() {
  _yes=0
  for a in "$@"; do [ "$a" = "--yes" ] && _yes=1; done

  _src="$(cd "$(dirname "$0")/.." && pwd)"
  printf '==> panoply apply (deterministic half) — kit %s\n' "$(_kit_version)"

  # 1. Spine. Create only what is absent; never overwrite the repo's own docs.
  mkdir -p docs/claude .claude/rules scripts
  for _d in roadmap.md in-progress.md worklog.md; do
    if [ ! -f "docs/claude/$_d" ] && [ -f "$_src/docs/claude/$_d" ]; then
      cp "$_src/docs/claude/$_d" "docs/claude/$_d"; printf '    seeded docs/claude/%s\n' "$_d"
    fi
  done

  # 2. Rule modules. Never clobber an edited module — report the divergence instead.
  for _m in "$_src"/.claude/rules/*.md; do
    [ -f "$_m" ] || continue
    _b="$(basename "$_m")"
    if [ ! -f ".claude/rules/$_b" ]; then
      cp "$_m" ".claude/rules/$_b"; printf '    added .claude/rules/%s\n' "$_b"
    elif ! cmp -s "$_m" ".claude/rules/$_b"; then
      printf '    NOTE .claude/rules/%s differs from the kit — yours wins; review the kit CHANGELOG\n' "$_b"
    fi
  done

  # 2b. The agent hub itself. Seed the TEMPLATE only when the repo has no hub of its own — its
  # tokens stay in place on purpose, which is what makes the next check report "unadapted" (13)
  # rather than "half-applied (missing AGENTS.md)" (11). Without this, apply can never reach a
  # state the agent can finish from: every adoption would stall until someone hand-wrote a hub
  # from scratch. A repo with its own AGENTS.md or CLAUDE.md is left completely alone here; the
  # agent merges the kit's structure into it as checklist step 3.
  if [ ! -f AGENTS.md ] && [ ! -f CLAUDE.md ] && [ -f "$_src/AGENTS.md" ]; then
    cp "$_src/AGENTS.md" AGENTS.md
    printf '    seeded AGENTS.md (kit template — fill its {{TOKENS}})\n'
  fi

  # 3. Gates + mirror generator.
  # Same contract as the rule modules above: NEVER silently clobber. A locally edited script is real
  # work — nexalog's check-docs.sh carries a conflict-marker sweep the kit template lacks — and
  # overwriting it is an unreported capability regression. Install when absent; when it differs,
  # report the divergence and leave the repo's copy alone. `--force-scripts` is the explicit opt-in
  # for a deliberate refresh, so the destructive path is always a stated choice.
  _force_scripts=0
  for a in "$@"; do [ "$a" = "--force-scripts" ] && _force_scripts=1; done
  for _s in panoply.sh panoply.test.sh sync-agents.sh check-docs.sh check-plan-home.sh; do
    [ -f "$_src/scripts/$_s" ] || continue
    if [ ! -f "scripts/$_s" ]; then
      cp "$_src/scripts/$_s" "scripts/$_s" && chmod +x "scripts/$_s"
      printf '    added scripts/%s\n' "$_s"
    elif ! cmp -s "$_src/scripts/$_s" "scripts/$_s"; then
      if [ "$_force_scripts" = "1" ]; then
        cp "$_src/scripts/$_s" "scripts/$_s" && chmod +x "scripts/$_s"
        printf '    OVERWROTE scripts/%s (--force-scripts)\n' "$_s"
      else
        printf '    KEPT scripts/%s — yours differs from the kit; compare before replacing\n' "$_s"
      fi
    fi
  done

  # 4. Stamp LAST among mechanical steps, so a failed apply never leaves a current-looking stamp.
  cmd_stamp

  # 5. The judgement half — an agent must do this, and the kit forbids guessing.
  cat <<'CHECKLIST'

==> remaining (agent work — the kit forbids scripting these):
    1. Fill every {{TOKEN}} from the project's OWN manifests/script table; delete any bullet you
       cannot fill with a verified value (an unfillable rule teaches the model to skim).
    2. Prune <!-- MODULE:x --> blocks that do not apply, and delete the rules files + @-imports
       they own. Never delete clean-architecture.md, workflow.md, or quality-bar.md.
    3. Merge — never overwrite — a pre-existing CLAUDE.md / AGENTS.md (the repo's own rules win).
    4. Run:  sh scripts/sync-agents.sh      (mirrors must be generated AFTER pruning)
    5. Run:  sh scripts/check-docs.sh && sh scripts/panoply.sh check

  A script this repo already had and has since edited was KEPT, not replaced (see any "KEPT scripts/"
  line above). Review it against the kit's copy and re-run with `apply --force-scripts` only when
  you mean to discard the local version.
CHECKLIST
}

# ---------------------------------------------------------------- dispatch ----
_cmd="${1:-check}"
shift 2>/dev/null || true
case "$_cmd" in
  check|status) cmd_check "$@" ;;
  apply)        cmd_apply "$@" ;;
  stamp)        cmd_stamp "$@" ;;
  version|-v|--version) cmd_version ;;
  -h|--help|help|"")
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) printf 'panoply: unknown command %s (try: check | apply | stamp | version)\n' "$_cmd" >&2; exit 2 ;;
esac
