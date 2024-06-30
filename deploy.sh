#!/bin/bash

# Define variables for the old and new containers
OLD_CONTAINER="deluxebotcontained"
NEW_CONTAINER="deluxebotcontained_new"
IMAGE_NAME="deluxebotdocked"
OLD_IMAGE_NAME="${IMAGE_NAME}_old"
NETWORK_NAME="bot_network"
CONTAINER_ALIAS="deluxebot"

# Function to check if a container is running
is_container_running() {
    [ "$(docker inspect -f '{{.State.Running}}' $1 2>/dev/null)" = "true" ]
}

# Pull the latest changes from the repository
git pull

# Build the new Docker image
docker build -t ${IMAGE_NAME} .

# Create a Docker network if it doesn't exist
docker network inspect ${NETWORK_NAME} >/dev/null 2>&1 || docker network create ${NETWORK_NAME}

# Ensure the old container is stopped and removed
if is_container_running ${OLD_CONTAINER}; then
    docker stop ${OLD_CONTAINER}
    docker rm ${OLD_CONTAINER}
else
    # Remove the old container if it exists but isn't running
    docker rm ${OLD_CONTAINER} 2>/dev/null || true
fi

# Run the new container on the same network with a temporary name
docker run -d -p 80:3000 --network ${NETWORK_NAME} --network-alias ${CONTAINER_ALIAS}_new --name ${NEW_CONTAINER} ${IMAGE_NAME}

# Check if the new container is running successfully
if is_container_running ${NEW_CONTAINER}; then
    echo "New container is running successfully."

    # Update network alias to point to the new container
    docker network disconnect ${NETWORK_NAME} ${OLD_CONTAINER} 2>/dev/null || true
    docker network connect --alias ${CONTAINER_ALIAS} ${NETWORK_NAME} ${NEW_CONTAINER}

    # Rename the new container to the original name
    docker rename ${NEW_CONTAINER} ${OLD_CONTAINER}

    # Remove the old image
    docker rmi ${OLD_IMAGE_NAME}

    # Tag the current image as the old image for potential rollback
    docker tag ${IMAGE_NAME} ${OLD_IMAGE_NAME}

    echo "Update completed successfully."
else
    echo "Failed to start the new container. Keeping the old container running if it exists."
    docker rm -f ${NEW_CONTAINER}
fi
