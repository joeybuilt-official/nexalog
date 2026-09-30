#!/usr/bin/env sh
# check-expert-review.sh — CI gate verifying expert review evidence for non-trivial PRs.
# Exits 0 if review evidence found or PR is trivial; exits 1 with reason if missing.
# Usage: sh scripts/check-expert-review.sh [--since <base-sha>]
#   --since: check all commits in range (CI mode). Default: check current PR via env.

# `grep ... | wc -l` is deliberate over `grep -c` (SC2126): grep -c exits 1 when the count is
# zero, and under `set -e` a command substitution that exits non-zero aborts the script — which
# is exactly the ordinary "this commit touches no schema files" case.
# shellcheck disable=SC2126
set -eu

# Trivial escape hatches
# 1. PR has label "trivial"
# 2. Latest commit message starts with "trivial:"
# 3. Only 1 file changed, ≤15 lines added, no schema/API/interface files

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# verify_review_evidence <label>
# Checks for:
# 1. a plan doc exists under docs/claude/**
# 2. a checklist item exists somewhere under docs/claude/** (checked or unchecked)
# 3. (opt-in, EXPERT_REVIEW_REQUIRE_SIGNOFFS=1) the PR body carries >=2 persona sign-offs
verify_review_evidence() {
  label="$1"

  # 1. plan.md exists (any area)
  if ! find docs/claude -name "plan.md" -type f 2>/dev/null | grep -q .; then
    echo "check-expert-review: $label — no plan.md found in docs/claude/**" >&2
    return 1
  fi

  # 2. a checklist item exists somewhere under docs/claude/**.
  #
  # Deliberately NOT "a checklist.md containing an UNCHECKED item", which is what this used to
  # demand. That was wrong twice over. It required a separate checklist.md, but every repo
  # surveyed keeps its checklist inside plan.md; and it required an OPEN item, so a repo that
  # finished its work — the definition of done — was blocked from committing until someone added
  # a fake open task. The gate asks whether review evidence EXISTS, not whether work remains.
  if ! grep -rlE '^[[:space:]]*- \[[ xX]\]' docs/claude 2>/dev/null | grep -q .; then
    echo "check-expert-review: $label — no checklist item found under docs/claude/**" >&2
    echo "  add a '- [ ] <step>' list to the plan doc for this work" >&2
    return 1
  fi

  # 3. PR description has >=2 persona sign-offs — OPT-IN ONLY.
  #
  # This used to arm itself whenever `gh` happened to be authenticated, which meant adding a
  # GH_TOKEN to any workflow would silently start requiring sign-offs across every repo carrying
  # the kit, all at once. Enforcement that switches on as a side effect of a credential is not
  # enforcement anyone agreed to, so it now needs EXPERT_REVIEW_REQUIRE_SIGNOFFS=1.
  if [ "${EXPERT_REVIEW_REQUIRE_SIGNOFFS:-0}" = "1" ] \
     && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    PR_NUMBER="${GITHUB_PR_NUMBER:-${CI_PR_NUMBER:-}}"
    if [ -n "$PR_NUMBER" ]; then
      body="$(gh pr view "$PR_NUMBER" --json body --jq .body 2>/dev/null || echo "")"
      # Count distinct persona sign-offs: Security, Performance, Maintainability, UX, <domain>
      signoffs=$(echo "$body" | grep -oE '^>?\s*(Security|Performance|Maintainability|UX|[A-Z][a-z]+):\s*(✓|approved|LGTM|sign.?off)' | sort -u | wc -l | tr -d ' ')
      if [ "${signoffs:-0}" -lt 2 ]; then
        echo "check-expert-review: $label — PR #$PR_NUMBER needs ≥2 persona sign-offs in description (found $signoffs)" >&2
        return 1
      fi
    fi
  fi

  return 0
}

fail=0
reason=""

# Check for trivial label via gh (if available in CI)
is_trivial=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  PR_NUMBER="${GITHUB_PR_NUMBER:-${CI_PR_NUMBER:-}}"
  if [ -n "$PR_NUMBER" ]; then
    if gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null | grep -q '^trivial$'; then
      is_trivial=1
      echo "check-expert-review: PR #$PR_NUMBER has 'trivial' label — skipping"
    fi
  fi
fi

# Check for trivial commit prefix
if [ "$is_trivial" -eq 0 ]; then
  LATEST_MSG="$(git log -1 --pretty=%s 2>/dev/null || echo "")"
  case "$LATEST_MSG" in
    trivial:*) is_trivial=1; echo "check-expert-review: commit message has 'trivial:' prefix — skipping" ;;
  esac
fi

# Check for trivial change (single file, ≤15 lines, no schema/API/interface)
if [ "$is_trivial" -eq 0 ]; then
  if [ "${1:-}" = "--since" ]; then
    # CI mode: check each commit in range
    ref="${2:?usage: check-expert-review.sh --since <ref>}"
    for sha in $(git rev-list "$ref"..HEAD); do
      [ "$(git rev-list --no-walk --count --merges "$sha")" -eq 0 ] || continue
      files="$(git show --name-only --format= "$sha" 2>/dev/null | grep -v '^$' | wc -l | tr -d ' ')"
      lines="$(git show --stat --format= "$sha" 2>/dev/null | tail -1 | awk '{print $4}' | sed 's/[+,]//g')"
      # Check for schema/API/interface files
      schema_files="$(git show --name-only --format= "$sha" 2>/dev/null | grep -E '\.(sql|prisma|graphql|proto|openapi|yaml|yml)$' | wc -l | tr -d ' ')"
      if [ "$files" -eq 1 ] && [ "${lines:-0}" -le 15 ] && [ "$schema_files" -eq 0 ]; then
        echo "check-expert-review: commit $sha is trivial (1 file, ${lines} lines, no schema) — skipping"
        continue
      fi
      # Non-trivial commit: verify review evidence
      if ! verify_review_evidence "$sha"; then
        fail=1
        reason="commit $sha: missing expert review evidence"
      fi
    done
  else
    # Pre-commit/local mode: check staged changes
    files="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
    lines="$(git diff --cached --stat 2>/dev/null | tail -1 | awk '{print $4}' | sed 's/[+,]//g')"
    schema_files="$(git diff --cached --name-only 2>/dev/null | grep -E '\.(sql|prisma|graphql|proto|openapi|yaml|yml)$' | wc -l | tr -d ' ')"
    if [ "$files" -eq 1 ] && [ "${lines:-0}" -le 15 ] && [ "$schema_files" -eq 0 ]; then
      echo "check-expert-review: staged change is trivial (1 file, ${lines} lines, no schema) — skipping"
    else
      if ! verify_review_evidence "staged"; then
        fail=1
        reason="staged change: missing expert review evidence"
      fi
    fi
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "check-expert-review: OK"
else
  echo "check-expert-review: FAILED — $reason" >&2
fi
exit "$fail"
