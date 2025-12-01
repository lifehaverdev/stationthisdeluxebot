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
INTERNAL_API_URL="${INTERNAL_API_URL:-http://localhost:4000/internal/v1/data}"
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
    local line
    line=$(grep -E "^${var_name}=" "${ENV_FILE}" | tail -n1 || true)
    if [[ -n "${line}" ]]; then
      local value="${line#${var_name}=}"
      value="${value%$'\r'}"
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      printf '%s' "${value}"
      return
    fi
  fi
  printf ''
}

INTERNAL_API_KEY_ADMIN="$(load_env_var INTERNAL_API_KEY_ADMIN)"
if [[ -z "${INTERNAL_CLIENT_KEY:-}" && -n "${INTERNAL_API_KEY_ADMIN}" ]]; then
  INTERNAL_CLIENT_KEY="${INTERNAL_API_KEY_ADMIN}"
else
  INTERNAL_CLIENT_KEY="${INTERNAL_CLIENT_KEY:-}"
fi

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

call_internal_api() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"

  if [[ -z "${INTERNAL_CLIENT_KEY}" ]]; then
    return 1
  fi

  local url="${INTERNAL_API_URL}${path}"
  local response status body

  if [[ "${method}" == "GET" ]]; then
    response=$(curl -sS -w '\n%{http_code}' -H "Content-Type: application/json" -H "X-Internal-Client-Key: ${INTERNAL_CLIENT_KEY}" "${url}" 2>>"${LOG_FILE}" || true)
  else
    response=$(curl -sS -w '\n%{http_code}' -H "Content-Type: application/json" -H "X-Internal-Client-Key: ${INTERNAL_CLIENT_KEY}" -X "${method}" -d "${payload:-{}}" "${url}" 2>>"${LOG_FILE}" || true)
  fi

  status="$(printf '%s\n' "${response}" | tail -n1)"
  body="$(printf '%s\n' "${response}" | sed '$d')"

  if [[ "${status}" =~ ^2 ]]; then
    printf '%s' "${body}"
    return 0
  fi

  log "Internal API ${method} ${path} failed (${status}): ${body}"
  return 1
}

json_field() {
  local field="$1"
  python3 - "$field" <<'PY' 2>/dev/null
import json, sys
data = sys.stdin.read()
try:
    payload = json.loads(data)
    value = payload
    for key in sys.argv[1].split('.'):
        if isinstance(value, dict):
            value = value.get(key)
        else:
            value = None
            break
    if value is None:
        value = ''
    print(value)
except Exception:
    print('')
PY
}

pause_worker() {
  if [[ -z "${INTERNAL_CLIENT_KEY}" ]]; then
    log "INTERNAL_CLIENT_KEY not set; skipping worker pause."
    return
  fi
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"reason": sys.argv[1]}))' "deploy")
  if call_internal_api "POST" "${WORKER_PAUSE_ENDPOINT}" "${payload}" >/dev/null; then
    WORKER_PAUSED=1
    log "Worker pause acknowledged."
  else
    log "Warning: unable to pause worker; proceeding."
  fi
}

wait_for_worker_idle() {
  if [[ -z "${INTERNAL_CLIENT_KEY}" ]]; then
    return
  fi
  log "Waiting for worker to become idle..."
  local start_ts
  start_ts=$(date +%s)
  while true; do
    local status_json state currentJob
    status_json=$(call_internal_api "GET" "${WORKER_STATUS_ENDPOINT}" || true)
    if [[ -n "${status_json}" ]]; then
      state=$(printf '%s' "${status_json}" | json_field "status")
      currentJob=$(printf '%s' "${status_json}" | json_field "activeJobId")
      log "Worker status: ${state:-unknown} ${currentJob:+(job ${currentJob})}"
      if [[ "${state}" != "busy" ]]; then
        return
      fi
    else
      log "Warning: unable to query worker status; assuming idle."
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
  if [[ -z "${INTERNAL_CLIENT_KEY}" ]]; then
    return
  fi
  if call_internal_api "POST" "${WORKER_RESUME_ENDPOINT}" '{}' >/dev/null; then
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
  local retries=20
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

pause_worker
wait_for_worker_idle

enable_maintenance

log "Stopping application container prior to build..."
stop_container_if_exists "${APP_CONTAINER}"

log "Cleaning up docker cache..."
docker builder prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true
docker image prune -a -f --filter "until=24h" >> "${LOG_FILE}" 2>&1 || true

log "Building new docker image..."
if docker image inspect "${IMAGE_NAME}:latest" >/dev/null 2>&1; then
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1 --cache-from ${IMAGE_NAME}:latest"
else
  CACHE_FROM_ARG="--build-arg BUILDKIT_INLINE_CACHE=1"
fi
docker build ${CACHE_FROM_ARG} -t "${IMAGE_NAME}:latest" . >> "${LOG_FILE}" 2>&1

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
  --env-file .env \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  -v "${MAINT_DIR}:${MAINT_DIR}" \
  --name "${APP_CONTAINER}" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE_NAME}"

if ! health_check_app; then
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
resume_worker

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
