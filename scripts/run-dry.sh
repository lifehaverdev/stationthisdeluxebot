#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
INTERNAL_API_URL="${INTERNAL_API_URL:-http://localhost:4000/internal/v1/data}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"
LOG_DIR="${REPO_ROOT}/logs"
mkdir -p "${LOG_DIR}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_DIR}/dry-run-${TIMESTAMP}.log"
ENV_FILE="${REPO_ROOT}/.env"

PIPE_PATH="$(mktemp -u /tmp/dry-run-pipe.XXXXXX)"
mkfifo "${PIPE_PATH}"
tee -a "${LOG_FILE}" < "${PIPE_PATH}" &
TEE_PID=$!
exec > "${PIPE_PATH}" 2>&1
cleanup_pipe() {
  rm -f "${PIPE_PATH}"
  kill "${TEE_PID}" >/dev/null 2>&1 || true
}
trap cleanup_pipe EXIT

load_env_var() {
  local var_name="$1"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then
    printf '%s' "${current}"
    return
  fi
  if [[ -f "${ENV_FILE}" ]]; then
    local value
    value=$(grep -E "^${var_name}=" "${ENV_FILE}" | tail -n1 | sed -E "s/^${var_name}=//" | tr -d '\r"' || true)
    printf '%s' "${value}"
    return
  fi
  printf ''
}

MAINT_FLAG="${MAINTENANCE_MODE_FILE:-/tmp/hyperbot-maintenance.flag}"
mkdir -p "$(dirname "${MAINT_FLAG}")" 2>/dev/null || true

INTERNAL_API_KEY_ADMIN="$(load_env_var INTERNAL_API_KEY_ADMIN)"
if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
  echo "[dry-run] INTERNAL_API_KEY_ADMIN is required."
  exit 1
fi

WORKER_CTL="node ${REPO_ROOT}/scripts/export-worker-control.js"

echo "[dry-run] Starting dry run at $(date)"
echo "[dry-run] Logs: ${LOG_FILE}"

if ! command -v node >/dev/null 2>&1; then
  echo "[dry-run] Node.js not found in PATH."
  exit 1
fi

check_health() {
  local url="$1"
  echo "[dry-run] Checking ${url}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "${url}")
  if [[ "${status}" == "200" ]]; then
    echo "[dry-run] Health OK (${url})"
  else
    echo "[dry-run] WARNING: ${url} returned ${status}"
  fi
}

call_worker() {
  local cmd="$1"
  shift
  INTERNAL_API_BASE="${INTERNAL_API_URL}" INTERNAL_API_KEY_ADMIN="${INTERNAL_API_KEY_ADMIN}" \
    ${WORKER_CTL} "${cmd}" "$@" || {
      echo "[dry-run] Worker ${cmd} command failed."
      return 1
    }
}

check_health "${BASE_URL}/api/health"

echo "[dry-run] Step 2: Worker status"
call_worker status

echo "[dry-run] Step 3: Pause worker"
call_worker pause "dry-run-test"
call_worker status

echo "[dry-run] Step 4: Resume worker"
call_worker resume
call_worker status

echo "[dry-run] Step 5: Maintenance flag simulation (${MAINT_FLAG})"
: > "${MAINT_FLAG}"
sleep 1
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/")
echo "[dry-run] GET / during maintenance returned ${STATUS}"
if [[ "${STATUS}" != "503" ]]; then
  echo "[dry-run] WARNING: expected HTTP 503 during maintenance."
fi
rm -f "${MAINT_FLAG}"
sleep 1
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health")
echo "[dry-run] GET /api/health post-maintenance returned ${STATUS}"

echo "[dry-run] Dry run complete."
