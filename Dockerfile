# syntax=docker/dockerfile:1.2
FROM node:20

# Create and change to the app directory.
WORKDIR /usr/src/app

USER node  # or add a safer custom user

# Optional hardening
# RUN useradd -m appuser && chown -R appuser /usr/src/app
# USER appuser

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
ENV WEB_PORT=4000

# Expose the port the app runs on (matches WEB_PORT)
EXPOSE 4000

# Run the web service on container startup using PM2.
CMD ["pm2-runtime", "start", "app.js", "--name", "hyperbot"]