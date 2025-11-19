#!/bin/bash

# HyperBot Log Monitoring Script
# Interactive script to monitor live logs from HyperBot containers
# Usage: ./logs.sh [container_name] [--caddy] [--lines N] [--follow]

# --- Configuration -----------------------------------------------------------

# Default container name (matches deploy.sh)
DEFAULT_CONTAINER="hyperbotcontained"
CADDY_CONTAINER="caddy_proxy"

# Log file paths (matches deploy.sh)
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot.log"
CADDY_LOG_FILE="${LOG_DIR}/caddy.log"

# Default number of lines to show before following
DEFAULT_LINES=50

# --- Helper functions --------------------------------------------------------

is_container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' $1 2>/dev/null)" = "true" ]
}

show_usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  [container_name]    Container name to monitor (default: ${DEFAULT_CONTAINER})"
  echo "  --caddy             Monitor Caddy proxy logs instead"
  echo "  --lines N           Show last N lines before following (default: ${DEFAULT_LINES})"
  echo "  --no-follow         Show logs without following (exit after showing)"
  echo "  --file              Read from log file instead of container logs"
  echo "  --help              Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                          # Monitor default container logs"
  echo "  $0 --caddy                  # Monitor Caddy logs"
  echo "  $0 --lines 100              # Show last 100 lines then follow"
  echo "  $0 --file                   # Read from log file"
  echo "  $0 hyperbotcontained_new    # Monitor specific container"
}

# --- Parse arguments ---------------------------------------------------------

CONTAINER_NAME="${DEFAULT_CONTAINER}"
SHOW_CADDY=false
LINES="${DEFAULT_LINES}"
FOLLOW=true
USE_FILE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --caddy)
      SHOW_CADDY=true
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

# --- Determine what to monitor -----------------------------------------------

if [ "$SHOW_CADDY" = true ]; then
  CONTAINER_NAME="${CADDY_CONTAINER}"
  TARGET_FILE="${CADDY_LOG_FILE}"
else
  TARGET_FILE="${LOG_FILE}"
fi

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
    tail -n "${LINES}" "${TARGET_FILE}" && tail -f "${TARGET_FILE}"
  else
    tail -n "${LINES}" "${TARGET_FILE}"
  fi
else
  # Read from container logs
  if ! is_container_running "${CONTAINER_NAME}"; then
    echo "⚠️  Container '${CONTAINER_NAME}' is not running."
    echo "   Attempting to read from log file instead: ${TARGET_FILE}"
    echo ""
    
    if [ -f "${TARGET_FILE}" ]; then
      if [ "$FOLLOW" = true ]; then
        tail -n "${LINES}" "${TARGET_FILE}" && tail -f "${TARGET_FILE}"
      else
        tail -n "${LINES}" "${TARGET_FILE}"
      fi
    else
      echo "❌ Log file also not found: ${TARGET_FILE}"
      exit 1
    fi
  else
    echo "🐳 Monitoring container: ${CONTAINER_NAME}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    if [ "$FOLLOW" = true ]; then
      # Show last N lines, then follow
      docker logs --tail "${LINES}" -f "${CONTAINER_NAME}" 2>&1
    else
      # Just show last N lines
      docker logs --tail "${LINES}" "${CONTAINER_NAME}" 2>&1
    fi
  fi
fi

