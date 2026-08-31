#!/bin/bash
# Read-only preflight: is this checkout/machine worth driving?
# Usage: .claude/skills/verify-log-viewer/doctor.sh   (from apps/inspect)
# Env (same knobs as playwright.verify.config.ts):
#   VERIFY_VIEWER_PORT (5179) VERIFY_VIEW_SERVER_PORT (7677)
#   INSPECT_BIN (inspect) VERIFY_LOG_DIR (~/code/viewer-validation/logs)

viewer_port="${VERIFY_VIEWER_PORT:-5179}"
view_server_port="${VERIFY_VIEW_SERVER_PORT:-7677}"
inspect_bin="${INSPECT_BIN:-inspect}"
log_dir="${VERIFY_LOG_DIR:-$HOME/code/viewer-validation/logs}"
ok=0

port_status() {
  local port="$1" label="$2"
  local owner
  owner=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1 " (pid " $2 ")"}')
  if [ -n "$owner" ]; then
    echo "BUSY  $label port $port owned by $owner — harness will refuse (reuseExistingServer: false); stop it or pick another port"
    ok=1
  else
    echo "ok    $label port $port free"
  fi
}

port_status "$view_server_port" "view-server"
port_status "$viewer_port" "viewer"

if command -v "$inspect_bin" >/dev/null 2>&1; then
  echo "ok    inspect CLI: $("$inspect_bin" --version 2>/dev/null)"
else
  echo "FAIL  inspect CLI not found ($inspect_bin) — set INSPECT_BIN (see SKILL.md → Configuration knobs)"
  ok=1
fi

eval_count=$(find "$log_dir" -maxdepth 1 -name '*.eval' 2>/dev/null | wc -l | tr -d ' ')
if [ "$eval_count" -gt 0 ]; then
  echo "ok    fixtures: $eval_count .eval files in $log_dir"
else
  echo "FAIL  no .eval fixtures in $log_dir — set VERIFY_LOG_DIR"
  ok=1
fi

exit "$ok"
