# syntax=docker/dockerfile:1.2
FROM node:20

# Create and change to the app directory.
WORKDIR /usr/src/app

# Install git and ffmpeg first in a separate layer
RUN apt-get update \
  && apt-get install -y git ffmpeg \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies first
# This layer is only invalidated if package.json or package-lock.json changes
COPY package*.json ./

# Install only production dependencies (skip dev stack for faster builds)
ENV NODE_ENV=production
RUN npm install -g pm2 \
    && npm install --omit=dev --legacy-peer-deps

# Copy the rest of the application code
# Note: Docker will automatically invalidate this cache when files change
COPY . .

# Create necessary directories and set permissions before switching user
RUN mkdir -p tmp output storage/media \
    && chown -R node:node tmp output storage

# Set user after all root-level operations are done
USER node

# Set environment variable for the port the app should listen on internally
ENV WEB_PORT=4000

# Expose the port the app runs on (matches WEB_PORT)
EXPOSE 4000

# Run the web service on container startup using PM2.
CMD ["pm2-runtime", "start", "app.js", "--name", "hyperbot"]
