#!/bin/bash

# Stop the running container
docker stop deluxebotcontained

# Remove the stopped container
docker rm deluxebotcontained

# Remove the existing image
docker rmi deluxebotdocked

# Navigate to the project directory
#cd stationthisdeluxebot

# Pull the latest changes from the repository
git pull

# Build the new Docker image
docker build -t deluxebotdocked .

# Run the new container
docker run -d -p 80:3000 --name deluxebotcontained deluxebotdocked
