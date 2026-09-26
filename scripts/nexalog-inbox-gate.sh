#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Nexalog inbox worker — preflight gate.
# Exits 0 when the worker CAN run; nonzero with a clear message otherwise.
# Run this before every inbox pass (cron should `gate && run`).
set -uo pipefail

BRAIN="${BRAIN_REPO:-/srv/brain/pages}"
GBRAIN_REPO_IN_CONTAINER="${GBRAIN_REPO_IN_CONTAINER:-/brain/pages}"   # source binding inside the gbrain container
FAIL=0

fail() { echo "GATE FAIL: $*" >&2; FAIL=1; }

# 1. Brain repo present + is a git root
if [ ! -d "$BRAIN/.git" ]; then
  fail "brain repo git root missing at $BRAIN/.git"
else
  echo "ok: brain repo at $BRAIN"
fi

# 2. Git identity set (missing -> capture/commit 400 "Committer identity unknown")
if [ -d "$BRAIN/.git" ]; then
  NAME=$(git -C "$BRAIN" config user.name || true)
  EMAIL=$(git -C "$BRAIN" config user.email || true)
  if [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
    fail "brain repo git identity not set (user.name='$NAME' user.email='$EMAIL')"
  else
    echo "ok: git identity $NAME <$EMAIL>"
  fi
fi

# 3. Inbox dir exists
if [ ! -d "$BRAIN/inbox" ]; then
  fail "inbox dir missing at $BRAIN/inbox"
else
  echo "ok: inbox dir present ($(find "$BRAIN/inbox" -name '*.md' | wc -l) capture(s))"
fi

# 4. Typed dirs present (write targets)
for d in people companies concepts projects atoms; do
  if [ ! -d "$BRAIN/$d" ]; then
    fail "typed dir missing: $BRAIN/$d"
  fi
done
[ "$FAIL" -eq 0 ] && echo "ok: typed dirs present (people/companies/concepts/projects/atoms)"

# 5. gbrain container reachable (sync + embed live there) AND the source binding path exists
if command -v docker >/dev/null 2>&1; then
  if ! docker exec gbrain sh -c 'command -v gbrain' >/dev/null 2>&1; then
    fail "gbrain CLI not reachable via 'docker exec gbrain'"
  else
    echo "ok: gbrain CLI reachable"
    if docker exec gbrain sh -c "[ -d '$GBRAIN_REPO_IN_CONTAINER/.git' ]" 2>/dev/null; then
      echo "ok: gbrain source binding present ($GBRAIN_REPO_IN_CONTAINER)"
    else
      fail "gbrain source binding missing ($GBRAIN_REPO_IN_CONTAINER/.git not found in container) — sync --repo would fail"
    fi
  fi
else
  echo "warn: docker not on PATH here — skipping gbrain reachability (run this gate ON prod-host)"
fi

# 6. GBrain MCP reachable (optional — only needed for MCP-backed extraction)
if command -v curl >/dev/null 2>&1; then
  if [ -n "${MCP_GBRAIN_API_KEY:-}" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      -X POST "https://gbrain.example.com/mcp" \
      -H "Authorization: Bearer $MCP_GBRAIN_API_KEY" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' || true)
    if [ "$CODE" = "200" ]; then
      echo "ok: GBrain MCP reachable"
    else
      fail "GBrain MCP returned HTTP $CODE (key set: yes)"
    fi
  else
    echo "warn: MCP_GBRAIN_API_KEY not set — MCP-backed extraction will be skipped"
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED — fix the above before running the inbox worker." >&2
  exit 1
fi
echo "GATE OK — inbox worker may run."
exit 0
