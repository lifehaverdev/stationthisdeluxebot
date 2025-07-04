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

# --- Load Ethereum signer private key interactively unless SKIP_CREDIT_SERVICE=1 ---
if [ "${SKIP_CREDIT_SERVICE}" != "1" ]; then
  if [ -z "$ETHEREUM_SIGNER_PRIVATE_KEY" ]; then
    echo "Loading Ethereum signer private key from keystore..."
    ETHEREUM_SIGNER_PRIVATE_KEY="$(node scripts/local_dev_helpers/loadKeystore.js --path ~/.foundry/keystores/STATIONTHIS < /dev/tty | tr -d '\n')"
    export ETHEREUM_SIGNER_PRIVATE_KEY
  fi
else
  echo "[run-dev.sh] SKIP_CREDIT_SERVICE=1: Skipping Ethereum signer private key setup. CreditService will be inactive."
fi

# Run the application
node app.js
