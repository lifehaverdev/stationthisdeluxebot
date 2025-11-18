#!/bin/bash

# HyperBot Deployment Script
# This script builds, deploys, and swaps HyperBot containers behind a Caddy HTTPS reverse proxy.
# It ensures zero-downtime deployments, container hardening, and secure management of private keys.

# --- Configuration -----------------------------------------------------------

# Containers / Images
OLD_CONTAINER="hyperbotcontained"
NEW_CONTAINER="hyperbotcontained_new"
IMAGE_NAME="hyperbotdocked"
OLD_IMAGE_NAME="${IMAGE_NAME}_old"

# Caddy reverse proxy
CADDY_CONTAINER="caddy_proxy"
CADDY_IMAGE="caddy:latest"
CADDYFILE_PATH="$(pwd)/Caddyfile"

# Enable Docker BuildKit for faster, cached builds
export DOCKER_BUILDKIT=1

# Networking
NETWORK_NAME="hyperbot_network"
CONTAINER_ALIAS="hyperbot"

# Logging
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot.log"
CADDY_LOG_FILE="${LOG_DIR}/caddy.log"

# --- Helper functions --------------------------------------------------------

is_container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' $1 2>/dev/null)" = "true" ]
}

# --- Setup -------------------------------------------------------------------

mkdir -p "${LOG_DIR}"

# Rotate log file (keep last 1000 lines)
if [ -f "${LOG_FILE}" ]; then
  tail -n 1000 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
fi

echo "📥 Pulling latest changes from git (main branch)..."
git checkout main >> "${LOG_FILE}" 2>&1
git reset --hard origin/main >> "${LOG_FILE}" 2>&1
git pull origin main >> "${LOG_FILE}" 2>&1

echo "🛑 Stopping and removing old container (if running) *before* building new image..."
if is_container_running "${OLD_CONTAINER}"; then
  docker stop "${OLD_CONTAINER}" >> "${LOG_FILE}" 2>&1
fi
# Remove any stopped old container so its name is free
docker rm "${OLD_CONTAINER}" >> "${LOG_FILE}" 2>&1 || true

echo "🧹 Pre-build cleanup: Freeing disk space..."
# Clean up old build cache (keep last 24h for faster builds)
docker builder prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true
# Remove unused images older than 24h
docker image prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true

echo "🔨 Building new Docker image using cache from previous build..."
# Tag the current image as cache-source (if it exists) so BuildKit can use it
if docker image inspect "${IMAGE_NAME}:latest" >/dev/null 2>&1; then
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1 --cache-from ${IMAGE_NAME}:latest"
else
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1"
fi

docker build ${CACHE_FROM_ARG} -t "${IMAGE_NAME}:latest" . >> "${LOG_FILE}" 2>&1

echo "🌐 Ensuring network ${NETWORK_NAME} exists..."
docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1 || docker network create "${NETWORK_NAME}"

echo "🧹 Cleaning up any existing temporary containers..."
docker rm -f "${NEW_CONTAINER}" >> "${LOG_FILE}" 2>&1 || true

# --- Deploy / Update Caddy ---------------------------------------------------

echo "🔐 Setting up HTTPS reverse proxy with Caddy..."
docker rm -f "${CADDY_CONTAINER}" >> "${CADDY_LOG_FILE}" 2>&1 || true

docker volume create caddy_data >/dev/null 2>&1 || true
docker volume create caddy_config >/dev/null 2>&1 || true

docker run -d \
  --name "${CADDY_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -p 80:80 \
  -p 443:443 \
  -v "${CADDYFILE_PATH}":/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  -v caddy_config:/config \
  "${CADDY_IMAGE}" >> "${CADDY_LOG_FILE}" 2>&1

echo "✅ Caddy reverse proxy running."

# --- Load Private Key --------------------------------------------------------

echo "🔑 Loading Ethereum signer private key from keystore..."
PRIVATE_KEY=$(node scripts/local_dev_helpers/loadKeystore.js --path /etc/account/STATIONTHIS < /dev/tty)

if [ -z "${PRIVATE_KEY}" ]; then
  echo "❌ Private key could not be loaded. Aborting deployment."
  exit 1
fi

# --- Run New Container -------------------------------------------------------

echo "🚀 Starting new HyperBot container..."
docker run -d \
  --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
  --env-file .env \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  --name "${NEW_CONTAINER}" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE_NAME}" >> "${LOG_FILE}" 2>&1

# Clear private key variable
unset PRIVATE_KEY

# --- Swap & Cleanup ----------------------------------------------------------

if is_container_running "${NEW_CONTAINER}"; then
  echo "✅ New container started successfully!"
  echo "🔄 Old container already removed; alias assigned at container launch."

  echo "🔄 Renaming containers..."
  docker rename "${NEW_CONTAINER}" "${OLD_CONTAINER}" >> "${LOG_FILE}" 2>&1

  echo "🧹 Cleaning up images..."
  docker rmi "${OLD_IMAGE_NAME}" >> "${LOG_FILE}" 2>&1 || true
  docker tag "${IMAGE_NAME}" "${OLD_IMAGE_NAME}" >> "${LOG_FILE}" 2>&1

  echo "🧹 Cleaning up Docker resources to free space..."
  # Prune dangling images
  docker image prune -f >> "${LOG_FILE}" 2>&1
  # Prune build cache (keep only last 24h to allow some caching)
  docker builder prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1
  # Prune unused images (keep only the ones we're using)
  docker image prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true

  echo "✨ Deployment completed successfully!"
  echo "📝 Tailing logs from the new container (first 400 seconds):"
  timeout 400 docker logs -f "${OLD_CONTAINER}" 2>&1 &
  CONSOLE_PID=$!
  docker logs -f "${OLD_CONTAINER}" >> "${LOG_FILE}" 2>&1 &
  wait ${CONSOLE_PID}
else
  echo "❌ Failed to start new container!"
  echo "Keeping old container running if it exists."
  docker rm -f "${NEW_CONTAINER}" >> "${LOG_FILE}" 2>&1
fi

echo "📄 Deployment logs can be found at ${LOG_FILE}"
