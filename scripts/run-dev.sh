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

# --- Mainnet enforcement ---
# run-dev.sh always targets Ethereum mainnet.
# For local Anvil/fork dev, use run-dev-anvil.sh instead.
export ETHEREUM_CHAIN_ID=1
if [ -z "$ETHEREUM_RPC_URL" ]; then
  echo "[run-dev.sh] ERROR: ETHEREUM_RPC_URL is not set. Add it to your .env (Alchemy/Infura mainnet endpoint)."
  exit 1
fi
echo "[run-dev.sh] Network: Ethereum Mainnet (chainId=1)"
echo "[run-dev.sh] RPC: $ETHEREUM_RPC_URL"

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
fi

# Cleanup on exit — kill both Express and Vite
cleanup() {
  if [ -n "$VITE_PID" ]; then
    echo "[run-dev.sh] Stopping Vite dev server..."
    kill "$VITE_PID" 2>/dev/null || true
  fi
  if [ -n "$EXPRESS_PID" ]; then
    echo "[run-dev.sh] Stopping Express..."
    kill "$EXPRESS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Start Express in background first
# Express :4000 → API, WebSocket, sandbox ESM, auth
# Vite :5173    → Frontend with HMR (proxies to Express)
#
# Dev workflow:
#   localhost:5173        → marketing site (HMR)
#   app.localhost:5173    → sandbox (HMR)
#   localhost:4000        → same but without HMR (static build)
#   app.localhost:4000    → same but without HMR (static build)
echo "[run-dev.sh] Starting Express on :4000..."
node app.js &
EXPRESS_PID=$!

# Wait for Express to accept connections before starting Vite
echo "[run-dev.sh] Waiting for Express to be ready on :4000..."
MAX_WAIT=60
WAITED=0
while ! (echo >/dev/tcp/localhost/4000) 2>/dev/null; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "[run-dev.sh] ERROR: Express did not start within ${MAX_WAIT}s. Check logs above."
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "[run-dev.sh] Express is ready (${WAITED}s). Starting Vite dev server on :5173..."

if [ -f "$FRONTEND_DIR/package.json" ]; then
  # Run Vite in foreground — script stays alive as long as Vite runs
  (cd "$FRONTEND_DIR" && npx vite --host)
fi
