# syntax=docker/dockerfile:1.2
FROM node:20

# Create and change to the app directory.
WORKDIR /usr/src/app

# Use build arguments for GitHub token
ARG GITHUB_TOKEN

# Install git
RUN apt-get update 
# && apt-get install -y git


# Copy local code to the container image.
COPY . .

# Clone the private repository using the token
# RUN git clone https://$GITHUB_TOKEN@github.com/lifehaverdev/stationthisdeluxebot.git .

# Install dependencies
RUN npm install

# Expose the port the app runs on
EXPOSE 3000

# Run the web service on container startup.
CMD [ "node", "server.js" ]
