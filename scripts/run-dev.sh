#!/bin/bash

# Exit on errors
set -e

# Load environment variables from .env
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      declare -x "$key"="$value"
    fi
  done < <(grep -v '^\s*#' .env | grep '=')
fi

# Default to disabling webhook-dependent credit actions in local dev unless explicitly overridden
if [ -z "$DISABLE_CREDIT_WEBHOOK_ACTIONS" ]; then
  export DISABLE_CREDIT_WEBHOOK_ACTIONS=1
  echo "[run-dev.sh] DISABLE_CREDIT_WEBHOOK_ACTIONS not set. Defaulting to 1 for run-dev."
else
  echo "[run-dev.sh] DISABLE_CREDIT_WEBHOOK_ACTIONS=$DISABLE_CREDIT_WEBHOOK_ACTIONS"
fi

# Skip credit service in dev by default (no keystore needed)
export SKIP_CREDIT_SERVICE="${SKIP_CREDIT_SERVICE:-1}"

# --- Frontend setup ---
FRONTEND_DIR="src/platforms/web/frontend"
if [ -f "$FRONTEND_DIR/package.json" ]; then
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "[run-dev.sh] Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi

  # Build once for Express fallback (production-like static serving)
  echo "[run-dev.sh] Building frontend (initial)..."
  (cd "$FRONTEND_DIR" && npm run build)

  # Start Vite dev server in background for HMR
  echo "[run-dev.sh] Starting Vite dev server on :5173..."
  (cd "$FRONTEND_DIR" && npx vite --host) &
  VITE_PID=$!
fi

# Cleanup Vite on exit
cleanup() {
  if [ -n "$VITE_PID" ]; then
    echo "[run-dev.sh] Stopping Vite dev server..."
    kill "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Run the Express backend
# Express :4000 → API, WebSocket, sandbox ESM, auth
# Vite :5173    → Frontend with HMR (proxies to Express)
#
# Dev workflow:
#   localhost:5173        → marketing site (HMR)
#   app.localhost:5173    → sandbox (HMR)
#   localhost:4000        → same but without HMR (static build)
#   app.localhost:4000    → same but without HMR (static build)
echo "[run-dev.sh] Starting Express on :4000..."
node app.js
