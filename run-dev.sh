#!/bin/bash

# Exit on errors
set -e

# Load environment variables from .env
grep -v '^\s*#' .env | grep '=' | while IFS='=' read -r key value; do
  key="$(echo "$key" | xargs)"
  value="$(echo "$value" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "$key=$value"
done

# Run the application
node app.js
