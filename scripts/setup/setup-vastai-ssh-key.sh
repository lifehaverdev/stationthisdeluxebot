#!/bin/bash
#
# setup-vastai-ssh-key.sh
#
# Creates a dedicated SSH key for VastAI GPU rentals.
# Best practices:
#   - ED25519 (modern, secure, fast)
#   - Dedicated key (not shared with other services)
#   - Stored in ~/.ssh/vastai/ subdirectory
#
# Usage:
#   ./scripts/setup/setup-vastai-ssh-key.sh
#
# After running, you'll need to:
#   1. Add the public key to VastAI dashboard
#   2. Update your .env file with the key path
#

set -e

# Configuration
KEY_DIR="$HOME/.ssh/vastai"
KEY_NAME="vastai_ed25519"
KEY_PATH="$KEY_DIR/$KEY_NAME"
KEY_COMMENT="vastai-training-$(hostname -s)"

echo "========================================"
echo "  VastAI SSH Key Setup"
echo "========================================"
echo ""

# Create directory if needed
if [ ! -d "$KEY_DIR" ]; then
  echo "[1/4] Creating key directory: $KEY_DIR"
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"
else
  echo "[1/4] Key directory exists: $KEY_DIR"
fi

# Check if key already exists
if [ -f "$KEY_PATH" ]; then
  echo ""
  echo "WARNING: Key already exists at $KEY_PATH"
  read -p "Overwrite? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 1
  fi
  rm -f "$KEY_PATH" "$KEY_PATH.pub"
fi

# Generate key
echo "[2/4] Generating ED25519 key..."
ssh-keygen -t ed25519 -f "$KEY_PATH" -C "$KEY_COMMENT" -N ""
chmod 600 "$KEY_PATH"
chmod 644 "$KEY_PATH.pub"

# Display results
echo "[3/4] Key generated successfully!"
echo ""
echo "========================================"
echo "  KEY INFORMATION"
echo "========================================"
echo ""
echo "Private key: $KEY_PATH"
echo "Public key:  $KEY_PATH.pub"
echo ""
echo "Fingerprint:"
ssh-keygen -lf "$KEY_PATH.pub"
echo ""

# Show public key for copying
echo "========================================"
echo "  PUBLIC KEY (copy this)"
echo "========================================"
echo ""
cat "$KEY_PATH.pub"
echo ""

# Instructions
echo "========================================"
echo "  NEXT STEPS"
echo "========================================"
echo ""
echo "[4/4] Complete setup with these steps:"
echo ""
echo "1. ADD TO VASTAI DASHBOARD:"
echo "   - Go to: https://cloud.vast.ai/account/"
echo "   - Scroll to 'SSH Keys' section"
echo "   - Click 'Add SSH Key'"
echo "   - Paste the public key shown above"
echo "   - Give it a name like 'training-server' or '$(hostname -s)'"
echo ""
echo "2. UPDATE YOUR .env FILE:"
echo "   Add or update this line in your .env:"
echo ""
echo "   VASTAI_SSH_KEY_PATH=$KEY_PATH"
echo ""
echo "3. VERIFY SETUP:"
echo "   Run a test search to confirm API access:"
echo "   ./run-with-env.sh node -e \"require('./src/core/services/vastai').VastAIService && console.log('OK')\""
echo ""
echo "========================================"
echo "  DONE"
echo "========================================"
