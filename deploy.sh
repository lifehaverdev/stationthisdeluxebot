#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

# ------------------------------------------------------------------
# StationThis Deployment Script (app + export worker awareness)
# ------------------------------------------------------------------

# Containers / Images
APP_CONTAINER="hyperbotcontained"
IMAGE_NAME="hyperbotdocked"
OLD_IMAGE_NAME="${IMAGE_NAME}_previous"
NETWORK_NAME="hyperbot_network"
CONTAINER_ALIAS="hyperbot"
WORKER_CONTAINER="hyperbotworker"
WORKER_ALIAS="hyperbot-worker"

# Reverse proxy (Caddy)
CADDY_CONTAINER="caddy_proxy"
CADDY_IMAGE="caddy:latest"
CADDYFILE_PATH="$(pwd)/Caddyfile"

# Logging / maintenance
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot.log"
CADDY_LOG_FILE="${LOG_DIR}/caddy.log"
MAINT_DIR="/var/run/hyperbot"
MAINT_FLAG="${MAINT_DIR}/maintenance.flag"

# Worker control
INTERNAL_API_URL="${INTERNAL_API_URL:-http://${CONTAINER_ALIAS}:4000/internal/v1/data}"
WORKER_STATUS_ENDPOINT="/collections/export/worker/status"
WORKER_PAUSE_ENDPOINT="/collections/export/worker/pause"
WORKER_RESUME_ENDPOINT="/collections/export/worker/resume"
WORKER_WAIT_TIMEOUT="${WORKER_WAIT_TIMEOUT:-1800}"   # seconds
WORKER_POLL_INTERVAL="${WORKER_POLL_INTERVAL:-15}"

# Build config
export DOCKER_BUILDKIT=1

WORKER_PAUSED=0
WORKER_RESUMED=0
MAINTENANCE_ENABLED=0

load_env_var() {
  local var_name="$1"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then
    printf '%s' "${current}"
    return
  fi
  if [[ -f "${ENV_FILE}" ]]; then
    local value
    value=$(grep -E "^${var_name}=" "${ENV_FILE}" | tail -n1 | sed -E "s/^${var_name}=//" | tr -d '\r\"'"'"'' || true)
    if [[ -n "${value}" ]]; then
      printf '%s' "${value}"
      return
    fi
  fi
  printf ''
}

INTERNAL_API_KEY_ADMIN="$(load_env_var INTERNAL_API_KEY_ADMIN)"

mkdir -p "${LOG_DIR}" "${MAINT_DIR}"

log() {
  local msg="$1"
  echo "[deploy] $msg" | tee -a "${LOG_FILE}"
}

run_logged() {
  # run command with output appended to LOG_FILE
  local desc="$1"
  shift
  log "$desc"
  "$@" >> "${LOG_FILE}" 2>&1
}

worker_ctl() {
  local cmd="$1"
  shift
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    log "INTERNAL_API_KEY_ADMIN not set; skipping worker ${cmd}."
    return 1
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
    log "Container ${APP_CONTAINER} not running; cannot execute worker ${cmd}."
    return 1
  fi

  local output status
  output=$(docker exec "${APP_CONTAINER}" \
    env INTERNAL_API_BASE="http://localhost:4000/internal/v1/data" \
    INTERNAL_API_KEY_ADMIN="${INTERNAL_API_KEY_ADMIN}" \
    node /usr/src/app/scripts/export-worker-control.js "$cmd" "$@" 2>> "${LOG_FILE}")
  status=$?
  if [[ -n "${output}" ]]; then
    printf '%s\n' "${output}" >> "${LOG_FILE}"
    printf '%s\n' "${output}"
  fi
  return ${status}
}

pause_worker() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    log "INTERNAL_API_KEY_ADMIN not set; skipping worker pause."
    return
  fi
  if worker_ctl pause "deploy" >/dev/null; then
    WORKER_PAUSED=1
    log "Worker pause acknowledged."
  else
    log "Warning: unable to pause worker; proceeding."
  fi
}

wait_for_worker_idle() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    return
  fi
  log "Waiting for worker to become idle..."
  local start_ts
  start_ts=$(date +%s)
  while true; do
    local status_json
    status_json=$(worker_ctl status || true)
    if [[ -z "${status_json}" ]]; then
      log "Warning: unable to query worker status; assuming idle."
      return
    fi
    local state currentJob
    state=$(printf '%s' "${status_json}" | python3 -c 'import json,sys; data=sys.stdin.read(); import json; obj=json.loads(data); print(obj.get("status",""))' 2>/dev/null || printf '')
    currentJob=$(printf '%s' "${status_json}" | python3 -c 'import json,sys; data=sys.stdin.read(); import json; obj=json.loads(data); print(obj.get("activeJobId",""))' 2>/dev/null || printf '')
    log "Worker status: ${state:-unknown} ${currentJob:+(job ${currentJob})}"
    if [[ "${state}" != "busy" ]]; then
      return
    fi
    local now elapsed
    now=$(date +%s)
    elapsed=$((now - start_ts))
    if (( elapsed > WORKER_WAIT_TIMEOUT )); then
      if [[ "${FORCE_DEPLOY:-0}" == "1" ]]; then
        log "Worker still busy after ${elapsed}s but FORCE_DEPLOY=1; continuing anyway."
        return
      fi
      log "Worker still busy after ${elapsed}s; aborting deploy."
      exit 1
    fi
    sleep "${WORKER_POLL_INTERVAL}"
  done
}

resume_worker() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    return
  fi
  if worker_ctl resume >/dev/null; then
    WORKER_RESUMED=1
    log "Worker resume acknowledged."
  else
    log "Warning: unable to resume worker (API unreachable?)."
  fi
}

enable_maintenance() {
  if [[ "${MAINTENANCE_ENABLED}" == "1" ]]; then
    return
  fi
  : > "${MAINT_FLAG}"
  MAINTENANCE_ENABLED=1
  log "Maintenance flag enabled (${MAINT_FLAG})."
}

disable_maintenance() {
  if [[ "${MAINTENANCE_ENABLED}" == "0" ]]; then
    return
  fi
  rm -f "${MAINT_FLAG}"
  MAINTENANCE_ENABLED=0
  log "Maintenance flag cleared."
}

cleanup() {
  if [[ "${WORKER_PAUSED}" == "1" && "${WORKER_RESUMED}" == "0" ]]; then
    resume_worker || true
  fi
  if [[ "${MAINTENANCE_ENABLED}" == "1" ]]; then
    disable_maintenance || true
  fi
}
trap cleanup EXIT

rotate_logs() {
  if [[ -f "${LOG_FILE}" ]]; then
    tail -n 1000 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
  fi
}

stop_container_if_exists() {
  local name="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    run_logged "Stopping container ${name}..." docker stop "${name}"
    run_logged "Removing container ${name}..." docker rm "${name}"
  fi
}

start_worker_container() {
  run_logged "Starting worker container..." docker run -d \
    --env COLLECTION_EXPORT_PROCESSING_ENABLED=true \
    --env-file .env \
    --network "${NETWORK_NAME}" \
    --network-alias "${WORKER_ALIAS}" \
    --name "${WORKER_CONTAINER}" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "${IMAGE_NAME}" \
    pm2-runtime start worker.js --name export-worker
}

ensure_worker_running() {
  if docker ps --format '{{.Names}}' | grep -q "^${WORKER_CONTAINER}$"; then
    log "Worker container already running."
    return
  fi
  log "Worker container not running; starting..."
  start_worker_container
}

ensure_network() {
  if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    run_logged "Creating docker network ${NETWORK_NAME}..." docker network create "${NETWORK_NAME}"
  fi
}

start_caddy() {
  run_logged "Restarting Caddy reverse proxy..." docker rm -f "${CADDY_CONTAINER}" || true
  run_logged "Creating caddy volumes..." docker volume create caddy_data >/dev/null 2>&1 || true
  docker volume create caddy_config >/dev/null 2>&1 || true
  run_logged "Starting caddy..." docker run -d \
    --name "${CADDY_CONTAINER}" \
    --network "${NETWORK_NAME}" \
    -p 80:80 \
    -p 443:443 \
    -v "${CADDYFILE_PATH}":/etc/caddy/Caddyfile \
    -v caddy_data:/data \
    -v caddy_config:/config \
    "${CADDY_IMAGE}"
}

health_check_app() {
  local retries=40
  local delay=5
  log "Checking application health..."
  while (( retries > 0 )); do
    if docker run --rm --network "${NETWORK_NAME}" curlimages/curl:8.5.0 -sS -f "http://${CONTAINER_ALIAS}:4000/api/health" >/dev/null 2>&1; then
      log "Application responded to /api/health."
      return 0
    fi
    retries=$((retries - 1))
    sleep "${delay}"
  done
  log "Application health check failed."
  return 1
}

# ---------------------------------------------------------------
# Deploy sequence
# ---------------------------------------------------------------

log "=== StationThis deployment started ==="
rotate_logs

log "Updating git repository..."
run_logged "Checkout main" git checkout main
run_logged "Reset to origin/main" git reset --hard origin/main
run_logged "Pull latest" git pull origin main

GIT_COMMIT=$(git rev-parse HEAD)
log "Current git commit: ${GIT_COMMIT}"
touch .docker-build-trigger
echo "${GIT_COMMIT}" > .docker-build-trigger

DEPLOY_WORKER_FLAG="${DEPLOY_WORKER:-0}"
if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  pause_worker
  wait_for_worker_idle
else
  log "Skipping worker pause (DEPLOY_WORKER not set)."
fi

enable_maintenance

log "Stopping application container prior to build..."
stop_container_if_exists "${APP_CONTAINER}"
if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  log "Stopping worker container prior to build..."
  stop_container_if_exists "${WORKER_CONTAINER}"
fi

log "Cleaning up docker cache..."
docker builder prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true
docker image prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true

log "Building new docker image (streaming build output)..."
if docker image inspect "${IMAGE_NAME}:latest" >/dev/null 2>&1; then
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1 --cache-from ${IMAGE_NAME}:latest"
else
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1"
fi
docker build ${CACHE_FROM_ARG} -t "${IMAGE_NAME}:latest" . 2>&1 | tee -a "${LOG_FILE}"

ensure_network
start_caddy

log "Loading Ethereum signer private key..."
PRIVATE_KEY=$(node scripts/local_dev_helpers/loadKeystore.js --path /etc/account/STATIONTHIS < /dev/tty)
if [[ -z "${PRIVATE_KEY}" ]]; then
  log "Failed to load private key; aborting."
  exit 1
fi

run_logged "Starting application container..." docker run -d \
  --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
  --env MAINTENANCE_MODE_FILE="${MAINT_FLAG}" \
  --env COLLECTION_EXPORT_PROCESSING_ENABLED=false \
  --env-file .env \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  -v "${MAINT_DIR}:${MAINT_DIR}" \
  --name "${APP_CONTAINER}" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE_NAME}"

if ! health_check_app; then
  log "Health check failed; collecting container logs..."
  if docker ps -a --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
    docker logs "${APP_CONTAINER}" | tail -n 200 >> "${LOG_FILE}" 2>&1 || true
  fi
  log "Health check failed; attempting to revert to previous image."
  stop_container_if_exists "${APP_CONTAINER}"
  if docker image inspect "${OLD_IMAGE_NAME}" >/dev/null 2>&1; then
    run_logged "Restarting previous application image..." docker run -d \
      --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
      --env MAINTENANCE_MODE_FILE="${MAINT_FLAG}" \
      --env-file .env \
      --network "${NETWORK_NAME}" \
      --network-alias "${CONTAINER_ALIAS}" \
      -v "${MAINT_DIR}:${MAINT_DIR}" \
      --name "${APP_CONTAINER}" \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      "${OLD_IMAGE_NAME}"
    log "Old application container restored; aborting deploy."
  else
    log "No previous image available to restore."
  fi
  exit 1
fi
unset PRIVATE_KEY

disable_maintenance
ensure_worker_running
if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  resume_worker
fi

log "Tagging previous image..."
if docker image inspect "${IMAGE_NAME}:latest" >/dev/null 2>&1; then
  docker tag "${IMAGE_NAME}:latest" "${OLD_IMAGE_NAME}" >> "${LOG_FILE}" 2>&1 || true
fi

log "Pruning dangling images..."
docker image prune -f >> "${LOG_FILE}" 2>&1 || true
docker builder prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true

log "Deployment complete. Recent logs:"
docker logs --tail 50 "${APP_CONTAINER}" 2>&1 | tee -a "${LOG_FILE}" || true

log "=== Deployment finished ==="
