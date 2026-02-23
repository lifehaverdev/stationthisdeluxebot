#!/bin/bash

# run-dev-anvil.sh — Dev server targeting a local Anvil RPC (fork or blank chain)
#
# Overrides Ethereum network config to point at local Anvil on :8545.
# Start Anvil separately before running this script, e.g.:
#   anvil                                  # blank chain (chainId 31337)
#   anvil --fork-url $ETHEREUM_RPC_URL     # mainnet fork
#
# localhost:5173        → marketing site (HMR)
# app.localhost:5173    → sandbox (HMR)

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

# Default to disabling webhook-dependent credit actions in local dev
if [ -z "$DISABLE_CREDIT_WEBHOOK_ACTIONS" ]; then
  export DISABLE_CREDIT_WEBHOOK_ACTIONS=1
  echo "[run-dev-anvil] DISABLE_CREDIT_WEBHOOK_ACTIONS=1 (default)"
fi

# Skip credit service (no keystore needed for local dev)
export SKIP_CREDIT_SERVICE="${SKIP_CREDIT_SERVICE:-1}"

# --- Anvil override ---
# Point all Ethereum network config at local Anvil regardless of .env values.
export ETHEREUM_RPC_URL="http://127.0.0.1:8545"
export ETHEREUM_CHAIN_ID=31337

# Sanity-check: is Anvil actually running?
if ! curl -sf -X POST "$ETHEREUM_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' > /dev/null 2>&1; then
  echo "[run-dev-anvil] WARNING: No response from Anvil at $ETHEREUM_RPC_URL"
  echo "[run-dev-anvil] Start Anvil first:  anvil"
  echo "[run-dev-anvil] Or fork mainnet:    anvil --fork-url <your-rpc-url>"
  echo "[run-dev-anvil] Continuing anyway..."
fi

echo "[run-dev-anvil] Network: Anvil local chain (chainId=31337)"
echo "[run-dev-anvil] RPC: $ETHEREUM_RPC_URL"

# --- Frontend setup ---
FRONTEND_DIR="src/platforms/web/frontend"
if [ -f "$FRONTEND_DIR/package.json" ]; then
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "[run-dev-anvil] Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi

  echo "[run-dev-anvil] Building frontend (initial)..."
  (cd "$FRONTEND_DIR" && npm run build)

  echo "[run-dev-anvil] Starting Vite dev server on :5173..."
  (cd "$FRONTEND_DIR" && npx vite --host) &
  VITE_PID=$!
fi

cleanup() {
  if [ -n "$VITE_PID" ]; then
    echo "[run-dev-anvil] Stopping Vite dev server..."
    kill "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[run-dev-anvil] Starting Express on :4000..."
node app.js
