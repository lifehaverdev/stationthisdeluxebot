#!/bin/bash

# Define variables for the old and new containers
OLD_CONTAINER="deluxebotcontained"
NEW_CONTAINER="deluxebotcontained_new"
IMAGE_NAME="deluxebotdocked"
OLD_IMAGE_NAME="${IMAGE_NAME}_old"
NETWORK_NAME="bot_network"
CONTAINER_ALIAS="deluxebot"
LOG_DIR="/var/log/deluxebot"
LOG_FILE="${LOG_DIR}/deluxebot.log"

# After the LOG_FILE variable, add Caddy-specific variables
CADDY_CONTAINER="caddy_proxy"
CADDY_IMAGE="caddy:latest"
CADDYFILE_PATH="$(pwd)/Caddyfile"
CADDY_LOG_FILE="${LOG_DIR}/caddy.log"

# Function to check if a container is running
is_container_running() {
    [ "$(docker inspect -f '{{.State.Running}}' $1 2>/dev/null)" = "true" ]
}

# Ensure the log directory exists
mkdir -p ${LOG_DIR}

# Truncate the log file to the last 1000 lines if it exists
if [ -f ${LOG_FILE} ]; then
    tail -n 1000 ${LOG_FILE} > ${LOG_FILE}.tmp && mv ${LOG_FILE}.tmp ${LOG_FILE}
fi

# Truncate the Caddy log file similarly
if [ -f ${CADDY_LOG_FILE} ]; then
    tail -n 1000 ${CADDY_LOG_FILE} > ${CADDY_LOG_FILE}.tmp && mv ${CADDY_LOG_FILE}.tmp ${CADDY_LOG_FILE}
fi

# Pull the latest changes from the repository
echo "Pulling latest changes from git..."
git reset --hard >> ${LOG_FILE} 2>&1
git pull >> ${LOG_FILE} 2>&1

# Build the new Docker image
echo "Building new Docker image..."
docker build -t ${IMAGE_NAME} . >> ${LOG_FILE} 2>&1

# Create a Docker network if it doesn't exist
echo "Ensuring network ${NETWORK_NAME} exists..."
docker network inspect ${NETWORK_NAME} >/dev/null 2>&1 || docker network create ${NETWORK_NAME}

# --- CADDY DEPLOYMENT ---
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

echo "✅ Caddy reverse proxy running and serving HTTPS"

CADDY_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CADDY_CONTAINER})
echo "[DEBUG] Caddy container IP on ${NETWORK_NAME}: ${CADDY_IP}" | tee -a ${LOG_FILE}
# Record Caddy container details
docker ps -a --filter "name=${CADDY_CONTAINER}" >> ${LOG_FILE}

docker network inspect ${NETWORK_NAME} >> ${LOG_FILE} 2>&1

# --- 🔐 LOAD PRIVATE KEY FROM KEYSTORE ---
PRIVATE_KEY=$(node scripts/local_dev_helpers/loadKeystore.js --path /etc/account/STATIONTHIS < /dev/tty)

if [ -z "$PRIVATE_KEY" ]; then
  echo "❌ Private key could not be loaded. Aborting deployment."
  exit 1
fi

# Ensure any existing new container is removed
echo "Cleaning up any existing temporary containers..."
docker rm -f ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1 || true

# Ensure the old container is stopped and removed
if is_container_running ${OLD_CONTAINER}; then
    echo "Stopping and removing old container..."
    docker stop ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1
    docker rm ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1
else
    echo "No old container running, cleaning up if it exists..."
    docker rm ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 || true
fi

# Run the new container
echo "Starting new container..."
docker run -d \
  --env ETHEREUM_SIGNER_PRIVATE_KEY="$PRIVATE_KEY" \
  --env-file .env \
  --network ${NETWORK_NAME} \
  --network-alias ${CONTAINER_ALIAS}_new \
  --name ${NEW_CONTAINER} \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  ${IMAGE_NAME} >> ${LOG_FILE} 2>&1
unset PRIVATE_KEY

# Check if the new container is running successfully
if is_container_running ${NEW_CONTAINER}; then
    BOT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${NEW_CONTAINER})
    echo "[DEBUG] Bot container (${NEW_CONTAINER}) IP on ${NETWORK_NAME}: ${BOT_IP}" | tee -a ${LOG_FILE}
    # Simple connectivity test from inside Caddy container to bot /status endpoint (non-fatal)
    STATUS_CODE=$(docker exec ${CADDY_CONTAINER} sh -c "curl -s -o /dev/null -w '%{http_code}' http://deluxebot:4000/status || true")
    echo "[DEBUG] HTTP status code from Caddy->Bot /status endpoint: ${STATUS_CODE}" | tee -a ${LOG_FILE}
    echo "Updating network configuration..."
    
    # Update network alias to point to the new container
    docker network disconnect ${NETWORK_NAME} ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 || true
    docker network connect --alias ${CONTAINER_ALIAS} ${NETWORK_NAME} ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1

    echo "🔄 Renaming containers and updating images..."
    docker rename ${NEW_CONTAINER} ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1
    
    echo "🧹 Cleaning up old images..."
    docker rmi ${OLD_IMAGE_NAME} >> ${LOG_FILE} 2>&1
    docker tag ${IMAGE_NAME} ${OLD_IMAGE_NAME} >> ${LOG_FILE} 2>&1
    
    echo "🧹 Pruning unused builds..."
    docker builder prune -a -f >> ${LOG_FILE} 2>&1
    
    echo "✨ Deployment completed successfully!"
    echo "📝 Tailing logs from the new container (first 30 seconds):"
    timeout 400 docker logs -f ${OLD_CONTAINER} 2>&1 &
    CONSOLE_PID=$!
    # Save logs continuously to log file
    docker logs -f ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 &
    # Only wait for the console logging to finish
    wait $CONSOLE_PID
else
    echo "❌ Failed to start new container!"
    echo "Keeping old container running if it exists."
    docker rm -f ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1


fi

# Print out the log file path for easy access
echo "Deployment logs can be found at ${LOG_FILE}"
