# syntax=docker/dockerfile:1.2
FROM node:20

# Create and change to the app directory.
WORKDIR /usr/src/app

# Install git and ffmpeg
RUN apt-get update \
  && apt-get install -y git ffmpeg \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy local code to the container image.
COPY . .

# Install dependencies
RUN npm install -g pm2 \
    && npm install

# Set environment variable for the port the app should listen on internally
ENV WEB_PORT=3000

# Expose the port the app runs on (matches WEB_PORT)
EXPOSE 3000

# Run the web service on container startup using PM2.
CMD ["pm2-runtime", "start", "app.js", "--name", "hyperbot"]