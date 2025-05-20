#!/bin/bash

# --- Configuration ---
# REQUIRED: Your Master Account ID
MASTER_ACCOUNT_ID="681a27d761a6acd963d084dd"

# REQUIRED: The exact toolId for your "quickmake" workflow.
# Examples: "comfy-fluxGeneral", "comfy-someOtherDeploymentId"
TOOL_ID="comfy-0a863d4e-1f43-4f56-924f-12a9f8ac1ac8" # <-- !!! UPDATE THIS IF NEEDED !!!

# The seed parameter name (likely "input_seed")
SEED_PARAM_NAME="input_seed"
SEED_VALUE=9999

# Your internal API base URL
INTERNAL_API_BASE_URL="http://localhost:4000" # <-- !!! UPDATE THIS PORT/URL IF NEEDED !!!

# --- Script Logic ---

if [ "$MASTER_ACCOUNT_ID" == "YOUR_MASTER_ACCOUNT_ID_HERE" ]; then
  echo "ERROR: Please update MASTER_ACCOUNT_ID in the script."
  exit 1
fi

if [ "$TOOL_ID" == "" ]; then
  echo "ERROR: Please update TOOL_ID in the script with the correct toolId for quickmake."
  exit 1
fi

API_ENDPOINT="${INTERNAL_API_BASE_URL}/internal/v1/data/users/${MASTER_ACCOUNT_ID}/preferences/${TOOL_ID}"

# Use printf to create a well-formed JSON string
JSON_PAYLOAD=$(printf '{"%s": %d}' "${SEED_PARAM_NAME}" "${SEED_VALUE}")

echo "Attempting to set preferences for tool '${TOOL_ID}' for user '${MASTER_ACCOUNT_ID}'..."
echo "Endpoint: ${API_ENDPOINT}"
echo "Payload: ${JSON_PAYLOAD}"
echo ""

# Make the API call
# If you need an internal API key, add it as a header:
# -H "X-Internal-Client-Key: YOUR_KEY_HERE" \
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Internal-Client-Key: 574948a7616873654d8436e9e2232e8e2377ab6def26e512b06084ab38ca74f4" \
  -d "${JSON_PAYLOAD}" \
  "${API_ENDPOINT}"

echo ""
echo ""
echo "Script finished."
echo "If the PUT request was successful (e.g., HTTP 200 OK and valid JSON response), try running your '/quickmake' command."
echo "You'll need to verify separately (e.g., via logs or generation output details) if seed ${SEED_VALUE} was used."