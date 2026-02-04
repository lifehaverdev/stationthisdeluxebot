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
  echo "[run-dev-training.sh] DISABLE_CREDIT_WEBHOOK_ACTIONS not set. Defaulting to 1."
fi

# Set training environment to development so we don't conflict with production workers
if [ -z "$TRAINING_ENVIRONMENT" ]; then
  export TRAINING_ENVIRONMENT=development
  echo "[run-dev-training.sh] TRAINING_ENVIRONMENT not set. Defaulting to 'development'."
fi

# --- Load Ethereum signer private key interactively unless SKIP_CREDIT_SERVICE=1 ---
if [ "${SKIP_CREDIT_SERVICE}" != "1" ]; then
  if [ -z "$ETHEREUM_SIGNER_PRIVATE_KEY" ]; then
    echo "Loading Ethereum signer private key from keystore..."
    ETHEREUM_SIGNER_PRIVATE_KEY="$(node scripts/local_dev_helpers/loadKeystore.js --path ~/.foundry/keystores/STATIONTHIS < /dev/tty | tr -d '\n')"
    export ETHEREUM_SIGNER_PRIVATE_KEY
  fi
else
  echo "[run-dev-training.sh] SKIP_CREDIT_SERVICE=1: Skipping Ethereum signer private key setup."
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
  echo -e "\n${YELLOW}[run-dev-training.sh] Shutting down...${NC}"

  # Kill all background jobs
  if [ -n "$APP_PID" ]; then
    echo -e "${YELLOW}[run-dev-training.sh] Stopping app (PID: $APP_PID)${NC}"
    kill $APP_PID 2>/dev/null || true
  fi

  if [ -n "$WORKER_PID" ]; then
    echo -e "${YELLOW}[run-dev-training.sh] Stopping worker (PID: $WORKER_PID)${NC}"
    kill $WORKER_PID 2>/dev/null || true
  fi

  if [ -n "$SWEEPER_PID" ]; then
    echo -e "${YELLOW}[run-dev-training.sh] Stopping sweeper loop (PID: $SWEEPER_PID)${NC}"
    kill $SWEEPER_PID 2>/dev/null || true
  fi

  # Wait for processes to terminate
  wait 2>/dev/null || true

  echo -e "${GREEN}[run-dev-training.sh] Shutdown complete${NC}"
  exit 0
}

# Set up trap for cleanup
trap cleanup SIGINT SIGTERM EXIT

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Training Dev Environment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Start the main app
echo -e "${BLUE}[APP]${NC} Starting main application..."
node app.js 2>&1 | sed "s/^/$(printf "${BLUE}[APP]${NC} ")/" &
APP_PID=$!
echo -e "${BLUE}[APP]${NC} Started with PID: $APP_PID"

# Wait for app to be ready (check if port is listening)
echo -e "${YELLOW}[run-dev-training.sh] Waiting for app to be ready...${NC}"
sleep 5

# Start the VastAI training worker
echo -e "${MAGENTA}[WORKER]${NC} Starting VastAI training worker..."
node scripts/workers/vastaiTrainingWorker.js 2>&1 | sed "s/^/$(printf "${MAGENTA}[WORKER]${NC} ")/" &
WORKER_PID=$!
echo -e "${MAGENTA}[WORKER]${NC} Started with PID: $WORKER_PID"

# Start sweeper loop (runs every 5 minutes in dev, 15 in prod)
SWEEPER_INTERVAL=${SWEEPER_INTERVAL_SECONDS:-300}  # 5 minutes default
echo -e "${CYAN}[SWEEPER]${NC} Starting instance sweeper (every ${SWEEPER_INTERVAL}s)..."

(
  while true; do
    sleep $SWEEPER_INTERVAL
    echo -e "${CYAN}[SWEEPER]${NC} Running sweep..."
    node scripts/workers/instanceSweeper.js 2>&1 | sed "s/^/$(printf "${CYAN}[SWEEPER]${NC} ")/" || true
  done
) &
SWEEPER_PID=$!
echo -e "${CYAN}[SWEEPER]${NC} Loop started with PID: $SWEEPER_PID"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services running${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${BLUE}[APP]${NC}     Main application"
echo -e "${MAGENTA}[WORKER]${NC}  VastAI training worker (env: ${TRAINING_ENVIRONMENT})"
echo -e "${CYAN}[SWEEPER]${NC} Instance sweeper (every ${SWEEPER_INTERVAL}s)"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for any process to exit
wait
