#!/bin/bash

# Comprehensive Test Script for Internal Noema API

# --- Configuration ---
BASE_URL="http://localhost:4000/internal/v1/data"
CURL_OPTS=(-s -H "Content-Type: application/json") # -s for silent, add -v for verbose debugging
JQ_INSTALLED=$(command -v jq)

# --- Globals ---
MASTER_ACCOUNT_ID=""
SESSION_ID=""
EVENT_ID=""
TRANSACTION_ID_CREDIT=""
TRANSACTION_ID_DEBIT=""
GENERATION_ID=""
WALLET_ADDRESS="0xtestwallet1234567890abcdef" # Example wallet address
API_KEY_PREFIX=""

# --- Helper Functions ---

# Check if jq is installed
if [ -z "$JQ_INSTALLED" ]; then
  echo "Error: jq is not installed. Please install jq to run this script."
  echo "e.g., 'brew install jq' or 'sudo apt-get install jq'"
  exit 1
fi

# Function to print section headers
print_header() {
  echo ""
  echo "-----------------------------------------"
  echo "$1"
  echo "-----------------------------------------"
}

# Function to make curl request, check status, and extract field
# Usage: make_request METHOD PATH JSON_DATA EXPECTED_STATUS [JQ_EXTRACT_FIELD] [VARIABLE_TO_SET]
make_request() {
  local method="$1"
  local path="$2"
  local json_data="$3"
  local expected_status="$4"
  local jq_extract_field="$5" # Optional: Field to extract (e.g., .sessionId)
  local var_to_set="$6"       # Optional: Variable name to store the extracted value

  local url="${BASE_URL}${path}"
  local http_status
  local response_body
  local extracted_value=""
  local curl_cmd

  echo "Testing: ${method} ${path}"
  if [ ! -z "$json_data" ]; then
    # Ensure JSON data is properly quoted for logging/debugging if needed
    echo "Data: ${json_data}"
  fi

  # Create temporary file for response body
  response_file=$(mktemp)

  # Build curl command
  if [ ! -z "$json_data" ]; then
     # Pass JSON data using --data (or --data-raw to be safer with special chars)
     curl_cmd=("curl" "${CURL_OPTS[@]}" -X "$method" -w "%"{"http_code"}"" -o "$response_file" --data-raw "$json_data" "$url")
  else
     curl_cmd=("curl" "${CURL_OPTS[@]}" -X "$method" -w "%"{"http_code"}"" -o "$response_file" "$url")
  fi

  # Execute curl command
  http_status=$("${curl_cmd[@]}")
  response_body=$(cat "$response_file")
  rm "$response_file" # Clean up temp file

  echo "Status: ${http_status} (Expected: ${expected_status})"
  echo "Response: ${response_body}"

  if [ "$http_status" != "$expected_status" ]; then
    echo "****** TEST FAILED ****** Expected status ${expected_status}, got ${http_status}"
    # Optionally exit on failure: exit 1
  else
    echo "Status Code OK."
    # Extract value if field specified
    if [ ! -z "$jq_extract_field" ]; then
        # Check if response is valid JSON before trying jq
        if jq -e . >/dev/null 2>&1 <<<"$response_body"; then
            extracted_value=$(echo "$response_body" | jq -r "$jq_extract_field // \"\"") # Use // \"\" to avoid 'null' string
            if [ ! -z "$var_to_set" ]; then
              if [ ! -z "$extracted_value" ]; then
                  eval "$var_to_set=\"$extracted_value\"" # Use quotes for eval safety
                  echo "Extracted: ${jq_extract_field} -> ${extracted_value} (Set ${var_to_set})"
              else
                  echo "Warning: Field '${jq_extract_field}' not found or null in response."
              fi
            else
              echo "Extracted: ${jq_extract_field} -> ${extracted_value}"
            fi
        else
            echo "Warning: Response is not valid JSON, cannot extract field '${jq_extract_field}'."
        fi
    fi
    echo "------ Test Passed ------"
  fi
  echo "" # Newline for readability
}


# --- Test Execution ---

# 1. User Core
print_header "User Core API (/users)"
TEST_PLATFORM="test_platform"
TEST_PLATFORM_ID="test_user_$(date +%s)" # Unique ID for testing

make_request POST "/users/find-or-create" '{"platform": "'"$TEST_PLATFORM"'", "platformId": "'"$TEST_PLATFORM_ID"'", "platformContext": {"testRun": "initial_create"}}' 201 ".masterAccountId" "MASTER_ACCOUNT_ID"
if [ -z "$MASTER_ACCOUNT_ID" ]; then echo "FATAL: Could not get MASTER_ACCOUNT_ID"; exit 1; fi

make_request POST "/users/find-or-create" '{"platform": "'"$TEST_PLATFORM"'", "platformId": "'"$TEST_PLATFORM_ID"'", "platformContext": {"testRun": "find_existing"}}' 200 ".masterAccountId"

make_request GET "/users/${MASTER_ACCOUNT_ID}" "" 200
make_request PUT "/users/${MASTER_ACCOUNT_ID}" '{"profile": {"displayName": "Test User Updated"}, "status": "active"}' 200
make_request GET "/users/by-platform/${TEST_PLATFORM}/${TEST_PLATFORM_ID}" "" 200

# 2. User Sessions
print_header "User Sessions API (/sessions, /users/{id}/sessions)"
make_request POST "/sessions" '{"masterAccountId": "'"$MASTER_ACCOUNT_ID"'", "platform": "'"$TEST_PLATFORM"'", "userAgent": "Integration Test Script"}' 201 "._id" "SESSION_ID"
if [ -z "$SESSION_ID" ]; then echo "FATAL: Could not get SESSION_ID"; exit 1; fi

make_request GET "/sessions/${SESSION_ID}" "" 200
make_request PUT "/sessions/${SESSION_ID}/activity" '{}' 200 # Empty body is likely fine for simple activity update
make_request GET "/users/${MASTER_ACCOUNT_ID}/sessions" "" 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/sessions/active?platform=${TEST_PLATFORM}" "" 200
# Note: End session happens later after other tests that might need it

# 3. User Events
print_header "User Events API (/events, /users/{id}/events, /sessions/{id}/events)"
make_request POST "/events" '{"masterAccountId": "'"$MASTER_ACCOUNT_ID"'", "sessionId": "'"$SESSION_ID"'", "eventType": "test_event", "eventData": {"detail": "Testing event creation"}, "sourcePlatform": "'"$TEST_PLATFORM"'"}' 201 "._id" "EVENT_ID"
if [ -z "$EVENT_ID" ]; then echo "FATAL: Could not get EVENT_ID"; exit 1; fi

make_request GET "/events/${EVENT_ID}" "" 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/events" "" 200
make_request GET "/sessions/${SESSION_ID}/events" "" 200

# 4. Wallets (Under User Core)
print_header "Wallets API (/users/{id}/wallets)"
make_request POST "/users/${MASTER_ACCOUNT_ID}/wallets" '{"address": "'"$WALLET_ADDRESS"'", "name": "Test Wallet", "tag": "test"}' 201
make_request GET "/users/${MASTER_ACCOUNT_ID}/wallets" "" 200 ".[0].address" # Corrected JQ path
make_request GET "/users/${MASTER_ACCOUNT_ID}/wallets/${WALLET_ADDRESS}" "" 200
make_request PUT "/users/${MASTER_ACCOUNT_ID}/wallets/${WALLET_ADDRESS}" '{"isPrimary": true, "name": "Primary Test Wallet"}' 200
make_request DELETE "/users/${MASTER_ACCOUNT_ID}/wallets/${WALLET_ADDRESS}" "" 204 # Corrected expected status to 204

# 5. API Keys (Under User Core)
print_header "API Keys API (/users/{id}/apikeys)"
make_request POST "/users/${MASTER_ACCOUNT_ID}/apikeys" '{"name": "Test Key", "permissions": ["read:data"]}' 201 ".keyPrefix" "API_KEY_PREFIX"
if [ -z "$API_KEY_PREFIX" ]; then echo "FATAL: Could not get API_KEY_PREFIX"; exit 1; fi
# We could also extract the full apiKey here if needed: .apiKey

make_request GET "/users/${MASTER_ACCOUNT_ID}/apikeys" "" 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/apikeys/${API_KEY_PREFIX}" "" 200
make_request PUT "/users/${MASTER_ACCOUNT_ID}/apikeys/${API_KEY_PREFIX}" '{"name": "Updated Test Key", "status": "inactive"}' 200
make_request DELETE "/users/${MASTER_ACCOUNT_ID}/apikeys/${API_KEY_PREFIX}" "" 204 # Corrected expected status to 204

# 6. User Economy (Under User Core)
print_header "User Economy API (/users/{id}/economy)"
# Initial GET might 404, or create default. Let's credit first to ensure it exists.
# make_request GET "/users/${MASTER_ACCOUNT_ID}/economy" "" 200 # Might fail if record doesn't exist yet

CREDIT_AMOUNT="10.50"
CREDIT_DESC="Test Credit"
CREDIT_TYPE="test_credit"
make_request POST "/users/${MASTER_ACCOUNT_ID}/economy/credit" '{"amountUsd": "'"$CREDIT_AMOUNT"'", "description": "'"$CREDIT_DESC"'", "transactionType": "'"$CREDIT_TYPE"'"}' 200 ".transaction._id" "TRANSACTION_ID_CREDIT"
if [ -z "$TRANSACTION_ID_CREDIT" ]; then echo "FATAL: Could not get TRANSACTION_ID_CREDIT"; exit 1; fi

make_request GET "/users/${MASTER_ACCOUNT_ID}/economy" "" 200 # Should definitely exist now

DEBIT_AMOUNT="5.25"
DEBIT_DESC="Test Debit"
DEBIT_TYPE="test_debit"
make_request POST "/users/${MASTER_ACCOUNT_ID}/economy/debit" '{"amountUsd": "'"$DEBIT_AMOUNT"'", "description": "'"$DEBIT_DESC"'", "transactionType": "'"$DEBIT_TYPE"'"}' 200 ".transaction._id" "TRANSACTION_ID_DEBIT"
if [ -z "$TRANSACTION_ID_DEBIT" ]; then echo "FATAL: Could not get TRANSACTION_ID_DEBIT"; exit 1; fi

# Test Insufficient Funds
INSUFFICIENT_DEBIT="1000.00"
make_request POST "/users/${MASTER_ACCOUNT_ID}/economy/debit" '{"amountUsd": "'"$INSUFFICIENT_DEBIT"'", "description": "Test Insufficient Funds", "transactionType": "test_fail_debit"}' 400

# Test Update XP
XP_CHANGE=50
make_request PUT "/users/${MASTER_ACCOUNT_ID}/economy/exp" '{"expChange": '"$XP_CHANGE"'}' 200 # Note: Sending XP as string in JSON, relies on API parsing

# 7. Transactions
print_header "Transactions API (/transactions, /users/{id}/transactions)"
make_request GET "/transactions/${TRANSACTION_ID_CREDIT}" "" 200
make_request GET "/transactions/${TRANSACTION_ID_DEBIT}" "" 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/transactions" "" 200

# 8. User Preferences (Under User Core)
print_header "User Preferences API (/users/{id}/preferences)"
PREF_SCOPE="testScope"
make_request GET "/users/${MASTER_ACCOUNT_ID}/preferences" "" 200 # Get all (might be empty initially)
make_request PUT "/users/${MASTER_ACCOUNT_ID}/preferences" '{"preferences": {"globalPref": "value1", "anotherPref": true}}' 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/preferences/${PREF_SCOPE}" "" 404 # Get scope (expect 404 initially)
make_request PUT "/users/${MASTER_ACCOUNT_ID}/preferences/${PREF_SCOPE}" '{"scopedPref": 123, "isEnabled": false}' 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/preferences/${PREF_SCOPE}" "" 200 # Get scope again (expect 200 now)

# 9. Generation Outputs
print_header "Generation Outputs API (/generations, /users/{id}/generations, /sessions/{id}/generations)"
make_request POST "/generations" '{"masterAccountId": "'"$MASTER_ACCOUNT_ID"'", "sessionId": "'"$SESSION_ID"'", "initiatingEventId": "'"$EVENT_ID"'", "serviceName": "test_service", "requestPayload": {"prompt": "test prompt"}}' 201 "._id" "GENERATION_ID"
if [ -z "$GENERATION_ID" ]; then echo "FATAL: Could not get GENERATION_ID"; exit 1; fi

make_request GET "/generations/${GENERATION_ID}" "" 200
make_request PUT "/generations/${GENERATION_ID}" '{"status": "completed", "responsePayload": {"result": "test result"}, "costUsd": "0.01"}' 200
make_request GET "/users/${MASTER_ACCOUNT_ID}/generations" "" 200
make_request GET "/sessions/${SESSION_ID}/generations" "" 200

# 10. End Session (Do this last)
print_header "Ending Session"
make_request PUT "/sessions/${SESSION_ID}/end" '{"endReason": "Test script completed"}' 200

# --- End of Tests ---
print_header "All Tests Completed"
echo "Master Account ID used: ${MASTER_ACCOUNT_ID}"
echo "Session ID used: ${SESSION_ID}"
echo "Check output above for any failures."

exit 0 