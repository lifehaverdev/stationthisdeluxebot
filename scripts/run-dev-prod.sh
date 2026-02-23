#!/bin/bash

# run-dev-prod.sh — Production-like dev server (uses built dist, no HMR)
# Use this to test the production build locally.
#
# localhost:4000        → marketing site
# app.localhost:4000    → sandbox

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

if [ -z "$DISABLE_CREDIT_WEBHOOK_ACTIONS" ]; then
  export DISABLE_CREDIT_WEBHOOK_ACTIONS=1
  echo "[run-dev-prod] DISABLE_CREDIT_WEBHOOK_ACTIONS=1 (default)"
fi

# --- Load Ethereum signer private key interactively unless SKIP_CREDIT_SERVICE=1 ---
if [ "${SKIP_CREDIT_SERVICE}" != "1" ]; then
  if [ -z "$ETHEREUM_SIGNER_PRIVATE_KEY" ]; then
    echo "Loading Ethereum signer private key from keystore..."
    ETHEREUM_SIGNER_PRIVATE_KEY="$(node scripts/local_dev_helpers/loadKeystore.js --path ~/.foundry/keystores/STATIONTHIS < /dev/tty | tr -d '\n')"
    export ETHEREUM_SIGNER_PRIVATE_KEY
  fi
else
  echo "[run-dev-prod] SKIP_CREDIT_SERVICE=1: Skipping key setup."
fi

# Build frontend
FRONTEND_DIR="src/platforms/web/frontend"
if [ -f "$FRONTEND_DIR/package.json" ]; then
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    (cd "$FRONTEND_DIR" && npm install)
  fi
  echo "[run-dev-prod] Building frontend..."
  (cd "$FRONTEND_DIR" && npm run build)
fi

export NODE_ENV=production
echo "[run-dev-prod] Starting Express on :4000 (production-like)..."
node app.js
