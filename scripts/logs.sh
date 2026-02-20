#!/bin/bash

# HyperBot Log Monitoring Script
# Interactive script to monitor live logs from HyperBot containers
# Usage: ./logs.sh [container_name] [--caddy] [--lines N] [--follow]

# --- Configuration -----------------------------------------------------------

# Default container name (matches deploy.sh)
DEFAULT_CONTAINER="hyperbotcontained"
CADDY_CONTAINER="caddy_proxy"
WORKER_CONTAINER="hyperbotworker"
TRAINING_CONTAINER="hyperbottraining"
SWEEPER_CONTAINER="hyperbotsweeper"

# Log file paths (matches deploy.sh)
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot.log"
CADDY_LOG_FILE="${LOG_DIR}/caddy.log"

# Default number of lines to show before following
DEFAULT_LINES=50

# Internal API base (for --set)
INTERNAL_API_BASE="${INTERNAL_API_BASE:-http://localhost:4000/internal}"

# --- Helper functions --------------------------------------------------------

is_container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' $1 2>/dev/null)" = "true" ]
}

show_usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  [container_name]        Container name to monitor (default: ${DEFAULT_CONTAINER})"
  echo "  --caddy                 Monitor Caddy proxy logs"
  echo "  --worker                Monitor export worker logs"
  echo "  --training              Monitor VastAI training worker logs"
  echo "  --sweeper               Monitor instance sweeper logs"
  echo "  --lines N               Show last N lines before following (default: ${DEFAULT_LINES})"
  echo "  --no-follow             Show logs without following (exit after showing)"
  echo "  --file                  Read from log file instead of container logs"
  echo "  -l, --level <level>     Only show logs at this level or above (error>warn>info>debug)"
  echo "  -m, --module <name>     Filter to a specific module"
  echo "  -u, --user <userId>     Filter to a specific userId"
  echo "  --set <module> <level>  Change a module's log level live (use '*' for all)"
  echo "  --help                  Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                              # Monitor main app logs"
  echo "  $0 --training                   # Monitor VastAI training worker"
  echo "  $0 --sweeper                    # Monitor instance sweeper"
  echo "  $0 --worker                     # Monitor export worker"
  echo "  $0 --caddy                      # Monitor Caddy logs"
  echo "  $0 --lines 100                  # Show last 100 lines then follow"
  echo "  $0 -l warn                      # warn and error only"
  echo "  $0 -m cook                      # cook module only"
  echo "  $0 -u usr_abc123                # one user's activity"
  echo "  $0 -l error -m telegram         # combine filters"
  echo "  $0 --set cook warn              # change cook level live"
  echo "  $0 --set '*' error              # silence everything except errors"
}

# --- Level comparison --------------------------------------------------------

level_value() {
  case "$1" in
    error) echo 0 ;;
    warn)  echo 1 ;;
    info)  echo 2 ;;
    debug) echo 3 ;;
    *)     echo 99 ;;
  esac
}

# Build a jq filter expression based on active filters
build_jq_filter() {
  local filter="."
  local conditions=()

  if [[ -n "${FILTER_MODULE}" ]]; then
    conditions+=("(.module // empty | ascii_downcase) == \"${FILTER_MODULE}\"")
  fi

  if [[ -n "${FILTER_USER}" ]]; then
    conditions+=("(.userId // .user_id // empty) == \"${FILTER_USER}\"")
  fi

  if [[ -n "${FILTER_LEVEL}" ]]; then
    local min_val
    min_val=$(level_value "${FILTER_LEVEL}")
    # Map level strings to numeric value for comparison
    conditions+=("(if .level == \"error\" then 0 elif .level == \"warn\" then 1 elif .level == \"info\" then 2 elif .level == \"debug\" then 3 else 99 end) <= ${min_val}")
  fi

  if [[ ${#conditions[@]} -gt 0 ]]; then
    local joined
    joined=$(printf " and %s" "${conditions[@]}")
    joined="${joined:5}" # remove leading " and "
    filter="select(${joined})"
  fi

  echo "${filter}"
}

# Pipe docker/file output through optional jq filtering
apply_filters() {
  if [[ -z "${FILTER_MODULE}" && -z "${FILTER_USER}" && -z "${FILTER_LEVEL}" ]]; then
    # No filters — pass through raw
    cat
  else
    local jq_filter
    jq_filter=$(build_jq_filter)
    # Non-JSON lines pass through; JSON lines are filtered
    while IFS= read -r line; do
      if echo "${line}" | jq -e . >/dev/null 2>&1; then
        echo "${line}" | jq -r --argjson _f null "if (${jq_filter} | . != null and . != false) then . else empty end" 2>/dev/null \
          | jq -r '[.timestamp // "", (.level // "" | ascii_upcase), (.module // ""), (.message // "")] | @tsv' 2>/dev/null \
          || true
      else
        echo "${line}"
      fi
    done
  fi
}

# --- Parse arguments ---------------------------------------------------------

CONTAINER_NAME="${DEFAULT_CONTAINER}"
LINES="${DEFAULT_LINES}"
FOLLOW=true
USE_FILE=false
FILTER_LEVEL=""
FILTER_MODULE=""
FILTER_USER=""
DO_SET=false
SET_MODULE=""
SET_LEVEL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --caddy)
      CONTAINER_NAME="${CADDY_CONTAINER}"
      shift
      ;;
    --worker)
      CONTAINER_NAME="${WORKER_CONTAINER}"
      shift
      ;;
    --training)
      CONTAINER_NAME="${TRAINING_CONTAINER}"
      shift
      ;;
    --sweeper)
      CONTAINER_NAME="${SWEEPER_CONTAINER}"
      shift
      ;;
    --lines)
      LINES="$2"
      shift 2
      ;;
    --no-follow)
      FOLLOW=false
      shift
      ;;
    --file)
      USE_FILE=true
      shift
      ;;
    -l|--level)
      FILTER_LEVEL="$2"
      shift 2
      ;;
    -m|--module)
      FILTER_MODULE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"
      shift 2
      ;;
    -u|--user)
      FILTER_USER="$2"
      shift 2
      ;;
    --set)
      DO_SET=true
      SET_MODULE="$2"
      SET_LEVEL="$3"
      shift 3
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1"
      show_usage
      exit 1
      ;;
    *)
      CONTAINER_NAME="$1"
      shift
      ;;
  esac
done

# --- Handle --set command ----------------------------------------------------

if [[ "${DO_SET}" == "true" ]]; then
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    echo "❌ INTERNAL_API_KEY_ADMIN env var is required for --set"
    exit 1
  fi
  echo "🔧 Setting log level: module=${SET_MODULE} level=${SET_LEVEL}"
  curl -s -X POST \
    -H "X-Internal-Client-Key: ${INTERNAL_API_KEY_ADMIN}" \
    -H "Content-Type: application/json" \
    -d "{\"module\":\"${SET_MODULE}\",\"level\":\"${SET_LEVEL}\"}" \
    "${INTERNAL_API_BASE}/v1/logs/levels" | jq
  exit $?
fi

# --- Determine what to monitor -----------------------------------------------

TARGET_FILE="${LOG_FILE}"

# --- Monitor logs ------------------------------------------------------------

echo "📋 HyperBot Log Monitor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$USE_FILE" = true ]; then
  # Read from log file
  if [ ! -f "${TARGET_FILE}" ]; then
    echo "❌ Log file not found: ${TARGET_FILE}"
    exit 1
  fi

  echo "📄 Reading from log file: ${TARGET_FILE}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ "$FOLLOW" = true ]; then
    { tail -n "${LINES}" "${TARGET_FILE}" && tail -f "${TARGET_FILE}"; } | apply_filters
  else
    tail -n "${LINES}" "${TARGET_FILE}" | apply_filters
  fi
else
  # Read from container logs
  if ! is_container_running "${CONTAINER_NAME}"; then
    echo "⚠️  Container '${CONTAINER_NAME}' is not running."
    echo "   Attempting to read from log file instead: ${TARGET_FILE}"
    echo ""

    if [ -f "${TARGET_FILE}" ]; then
      if [ "$FOLLOW" = true ]; then
        { tail -n "${LINES}" "${TARGET_FILE}" && tail -f "${TARGET_FILE}"; } | apply_filters
      else
        tail -n "${LINES}" "${TARGET_FILE}" | apply_filters
      fi
    else
      echo "❌ Log file also not found: ${TARGET_FILE}"
      exit 1
    fi
  else
    echo "🐳 Monitoring container: ${CONTAINER_NAME}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ "$FOLLOW" = true ]; then
      docker logs --tail "${LINES}" -f "${CONTAINER_NAME}" 2>&1 | apply_filters
    else
      docker logs --tail "${LINES}" "${CONTAINER_NAME}" 2>&1 | apply_filters
    fi
  fi
fi
