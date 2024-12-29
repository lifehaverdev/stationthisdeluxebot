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
docker run -d -p 80:3000 --network ${NETWORK_NAME} --network-alias ${CONTAINER_ALIAS}_new --name ${NEW_CONTAINER} ${IMAGE_NAME} >> ${LOG_FILE} 2>&1

# Check if the new container is running successfully
if is_container_running ${NEW_CONTAINER}; then
    echo "✅ New container started successfully!"
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
    timeout 10 docker logs -f ${OLD_CONTAINER} 2>&1 &
else
    echo "❌ Failed to start new container!"
    echo "Keeping old container running if it exists."
    docker rm -f ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1
fi

# Print out the log file path for easy access
echo "Deployment logs can be found at ${LOG_FILE}"
