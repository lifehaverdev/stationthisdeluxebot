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

# Pull the latest changes from the repository
git reset --hard >> ${LOG_FILE} 2>&1
git pull >> ${LOG_FILE} 2>&1

# Build the new Docker image
docker build -t ${IMAGE_NAME} . >> ${LOG_FILE} 2>&1

# Create a Docker network if it doesn't exist
docker network inspect ${NETWORK_NAME} >/dev/null 2>&1 || docker network create ${NETWORK_NAME}

# Ensure any existing new container is removed
docker rm -f ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1 || true

# Ensure the old container is stopped and removed
if is_container_running ${OLD_CONTAINER}; then
    docker stop ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1
    docker rm ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1
else
    # Remove the old container if it exists but isn't running
    docker rm ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 || true
fi

# Run the new container on the same network with a temporary name
docker run -d -p 80:3000 --network ${NETWORK_NAME} --network-alias ${CONTAINER_ALIAS}_new --name ${NEW_CONTAINER} ${IMAGE_NAME} >> ${LOG_FILE} 2>&1

# Check if the new container is running successfully
if is_container_running ${NEW_CONTAINER}; then
    echo "New container is running successfully." >> ${LOG_FILE} 2>&1

    # Update network alias to point to the new container
    docker network disconnect ${NETWORK_NAME} ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 || true
    docker network connect --alias ${CONTAINER_ALIAS} ${NETWORK_NAME} ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1

    # Rename the new container to the original name
    docker rename ${NEW_CONTAINER} ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1

    # Remove the old image
    docker rmi ${OLD_IMAGE_NAME} >> ${LOG_FILE} 2>&1

    # Tag the current image as the old image for potential rollback
    docker tag ${IMAGE_NAME} ${OLD_IMAGE_NAME} >> ${LOG_FILE} 2>&1

    echo "Update completed successfully." >> ${LOG_FILE} 2>&1

    # Clean up unused builds
    docker builder prune -a -f >> ${LOG_FILE} 2>&1

    # Output the logs of the running container
    echo "Attaching logs from the new container:" >> ${LOG_FILE} 2>&1
    docker logs -f ${OLD_CONTAINER} >> ${LOG_FILE} 2>&1 &

else
    echo "Failed to start the new container. Keeping the old container running if it exists." >> ${LOG_FILE} 2>&1
    docker rm -f ${NEW_CONTAINER} >> ${LOG_FILE} 2>&1
fi

# Print out the log file path for easy access
echo "Deployment logs can be found at ${LOG_FILE}"
