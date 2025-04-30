#!/bin/bash

# Build script for StationThis web canvas demonstration

echo "Building StationThis web canvas demonstration..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build the bundle
echo "Building bundle..."
npm run build

echo "Build complete! Open index.html in your browser to view the demonstration." 