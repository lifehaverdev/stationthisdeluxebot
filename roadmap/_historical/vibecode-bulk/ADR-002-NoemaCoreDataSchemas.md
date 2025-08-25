> Imported from vibecode/bulk/decisions/ADR-002-NoemaCoreDataSchemas.md on 2025-08-21

# ADR-002: Noema Core Data Schemas

## Date
05-07-25 - Please fill this in.

## Status
Proposed

## Context
This ADR defines the core MongoDB database schemas for the `noema` system. It builds upon the initial user model defined in `ADR-001-MasterUserAccountAndNoemaDB.md` and incorporates detailed requirements derived from user behavior analysis (`HANDOFF-2025-05-07-UserBehaviorAnalysis.md`, `/vibecode/reports/2025-05-06-UserBehaviorAnalysis.md`) for comprehensive session tracking, event logging, and generation output management.

The primary goals of these schemas are:
*   To support a multi-platform user experience (Telegram, Discord, Web, API).
*   To provide robust and granular data for user behavior analysis, system monitoring, and debugging.
*   To establish a clear and consistent data structure for all `noema` services.
*   To ensure data integrity and scalability.

All collections reside in the `noema` MongoDB database.

## Decision
The following MongoDB collection schemas are adopted for the `noema` database.

### 1. `userCore` Collection
*   **Description:** Stores the master record for each user, including identity, authentication details, and key profile information.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": [
        "_id", // masterAccountId
        "platformIdentities",
        "userCreationTimestamp",
        "updatedAt"
      ],
      "properties": {
        "_id": {
          "bsonType": "objectId",
          "description": "The masterAccountId, Primary Key for the user."
        },
        "platformIdentities": {
          "bsonType": "object",
          "description": "Maps platform names (e.g., telegram, discord, web) to platform-specific user IDs. At least one identity is typically required.",
          "additionalProperties": {
            "bsonType": "string"
          },
          "minProperties": 0
        },
        "wallets": {
          "bsonType": "array",
          "description": "Array of linked Ethereum wallet addresses.",
          "items": {
            "bsonType": "object",
            "required": ["address", "addedAt", "verified"],
            "properties": {
              "address": {"bsonType": "string", "description": "Ethereum wallet address (checksummed)."},
              "isPrimary": {"bsonType": "bool", "description": "True if this is the user's primary wallet."},
              "addedAt": {"bsonType": "date", "description": "Timestamp when the wallet was added."},
              "verified": {"bsonType": "bool", "description": "Verification status of the wallet."}
            }
          }
        },
        "apiKeys": {
          "bsonType": "array",
          "description": "Array of API keys associated with the user account.",
          "items": {
            "bsonType": "object",
            "required": ["keyHash", "label", "createdAt"],
            "properties": {
              "keyHash": {"bsonType": "string", "description": "Securely hashed API key."},
              "label": {"bsonType": "string", "description": "User-defined label for the API key."},
              "createdAt": {"bsonType": "date", "description": "Timestamp when the API key was created."},
              "lastUsedAt": {"bsonType": "date", "description": "Timestamp when the API key was last used."},
              "scopes": {
                "bsonType": "array",
                "description": "Permissions/scopes associated with the API key.",
                "items": {"bsonType": "string"}
              },
              "isActive": {"bsonType": "bool", "default": true, "description": "Whether the API key is currently active."}
            }
          }
        },
        "userCreationTimestamp": {
          "bsonType": "date",
          "description": "Timestamp when the user's master account was created."
        },
        "updatedAt": {
          "bsonType": "date",
          "description": "Timestamp when the user's core record was last updated."
        },
        "lastLoginTimestamp": {
          "bsonType": "date",
          "description": "Timestamp of the user's last login across any platform."
        },
        "lastSeenPlatform": {
          "bsonType": "string",
          "description": "Identifier of the last platform the user interacted with (e.g., telegram, web)."
        },
        "awards": {
          "bsonType": "array",
          "description": "Collection of awards or trophies earned by the user.",
          "items": {
            "bsonType": "object",
            "required": ["awardId", "achievedAt"],
            "properties": {
              "awardId": {"bsonType": "string", "description": "Unique identifier for the award (e.g., 'century_creator', 'early_adopter')."},
              "achievedAt": {"bsonType": "date", "description": "Timestamp when the award was achieved."},
              "displayName": {"bsonType": "string", "description": "User-facing name of the award."},
              "description": {"bsonType": "string", "description": "Brief description of the award."}
            }
          }
        },
        "profile": {
            "bsonType": "object",
            "description": "Optional user-configurable profile information.",
            "properties": {
                "displayName": {"bsonType": "string"},
                "avatarUrl": {"bsonType": "string"},
                "bio": {"bsonType": "string"}
            }
        },
        "status": {
            "bsonType": "string",
            "default": "active",
            "enum": ["active", "suspended", "deactivated_by_user", "deactivated_by_admin"]
        }
      }
    }
    ```

### 2. `userEconomy` Collection
*   **Description:** Manages user-specific economic data, such as credits and experience points.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": ["_id", "masterAccountId", "usdCredit", "exp", "createdAt", "updatedAt"],
      "properties": {
        "_id": {
          "bsonType": "objectId",
          "description": "Unique ID for the economy record."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "usdCredit": {
          "bsonType": "decimal",
          "description": "User's available funds in USD."
        },
        "exp": {
          "bsonType": "long",
          "description": "Cumulative experience points."
        },
        "createdAt": {
          "bsonType": "date",
          "description": "Timestamp when this economy record was created."
        },
        "updatedAt": {
          "bsonType": "date",
          "description": "Timestamp when this economy record was last updated."
        }
      }
    }
    ```

### 3. `userPreferences` Collection
*   **Description:** Stores user-defined preferences for various workflows, tools, or global settings.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": ["_id", "masterAccountId", "preferences", "createdAt", "updatedAt"],
      "properties": {
        "_id": {
          "bsonType": "objectId",
          "description": "Unique ID for the preferences record."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "preferences": {
          "bsonType": "object",
          "description": "Keys are workflow/tool IDs (e.g., workflowId_A, tool_imageEnhance) or 'globalSettings'. Values are objects containing specific settings.",
          "additionalProperties": {
            "bsonType": "object",
            "additionalProperties": true
          }
        },
        "createdAt": {
          "bsonType": "date",
          "description": "Timestamp when this preferences record was created."
        },
        "updatedAt": {
          "bsonType": "date",
          "description": "Timestamp when this preferences record was last updated."
        }
      }
    }
    ```

### 4. `transactions` Collection
*   **Description:** Logs all financial transactions related to a user's account.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": [
        "_id",
        "masterAccountId",
        "timestamp",
        "type",
        "description",
        "amountUsd",
        "balanceBeforeUsd",
        "balanceAfterUsd"
      ],
      "properties": {
        "_id": {
          "bsonType": "objectId",
          "description": "Unique ID for the transaction record."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "timestamp": {
          "bsonType": "date",
          "description": "Date and time of the transaction."
        },
        "type": {
          "bsonType": "string",
          "description": "Type of transaction (e.g., debit, credit, bonus, refund, generation_cost, subscription_payment)."
        },
        "description": {
          "bsonType": "string",
          "description": "Human-readable description of the transaction."
        },
        "amountUsd": {
          "bsonType": "decimal",
          "description": "Numeric value of the transaction (negative for debits)."
        },
        "balanceBeforeUsd": {
          "bsonType": "decimal",
          "description": "User's USD balance before this transaction."
        },
        "balanceAfterUsd": {
          "bsonType": "decimal",
          "description": "User's USD balance after this transaction."
        },
        "relatedItems": {
          "bsonType": "object",
          "description": "Object linking this transaction to other relevant records.",
          "properties": {
            "eventId": {"bsonType": "objectId", "description": "FK to userEvents.eventId that might have led to this transaction."},
            "generationId": {"bsonType": "objectId", "description": "FK to generationOutputs.generationId if this transaction is for a generation cost/refund."},
            "commandName": {"bsonType": "string", "description": "Name of the command related to this transaction, if applicable."},
            "subscriptionId": {"bsonType": "string", "description": "Identifier for a subscription, if applicable."}
          },
          "additionalProperties": false
        },
        "externalTransactionId": {
          "bsonType": "string",
          "description": "Optional ID from an external payment processor or system."
        },
        "metadata": {
          "bsonType": "object",
          "description": "Any other metadata relevant to the transaction.",
          "additionalProperties": true
        }
      }
    }
    ```

### 5. `userSessions` Collection
*   **Description:** Tracks individual user sessions across all platforms.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": [
        "sessionId",
        "masterAccountId",
        "startTime",
        "platform",
        "isActive",
        "lastUserActivityTimestamp"
      ],
      "properties": {
        "sessionId": {
          "bsonType": "objectId",
          "description": "Unique system-generated ID for the session (Primary Key)."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "startTime": {
          "bsonType": "date",
          "description": "Timestamp when the session began."
        },
        "endTime": {
          "bsonType": "date",
          "description": "Timestamp when the session ended. Null if active."
        },
        "endReason": {
          "bsonType": "string",
          "description": "Reason for session termination (e.g., user_logout, project_close, session_timeout_inactive, session_error_limit_exceeded, user_command_quit, system_shutdown). Null if active.",
          "enum": [
            "user_logout",
            "project_close",
            "session_timeout_inactive",
            "session_error_limit_exceeded",
            "user_command_quit",
            "system_shutdown",
            null
          ]
        },
        "platform": {
          "bsonType": "string",
          "description": "Platform where the session originated (e.g., telegram, discord, web, api)."
        },
        "isActive": {
          "bsonType": "bool",
          "description": "True if the session is currently active, false otherwise."
        },
        "lastUserActivityTimestamp": {
          "bsonType": "date",
          "description": "Timestamp of the last recorded user activity within this session."
        },
        "userAgent": {
          "bsonType": "string",
          "description": "User agent string, primarily for web or API sessions (optional)."
        },
        "metadata": {
          "bsonType": "object",
          "description": "Optional field for any other session-specific metadata (e.g., device_info, client_version).",
          "additionalProperties": true
        }
      }
    }
    ```

### 6. `userEvents` Collection
*   **Description:** Logs all significant user interactions and system events. This is the primary source for behavior analysis.
*   **Companion Document:** See `NOEMA_EVENT_CATALOG.md` at `vibecode/docs/NOEMA_EVENT_CATALOG.md` for detailed `eventType` definitions and their `eventData` schemas.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": [
        "eventId",
        "masterAccountId",
        "sessionId",
        "timestamp",
        "eventType",
        "sourcePlatform"
      ],
      "properties": {
        "eventId": {
          "bsonType": "objectId",
          "description": "Unique ID for the event (Primary Key)."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "sessionId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userSessions.sessionId."
        },
        "timestamp": {
          "bsonType": "date",
          "description": "Precise timestamp when the event occurred."
        },
        "eventType": {
          "bsonType": "string",
          "description": "Granular type of the event. See NOEMA_EVENT_CATALOG.md for comprehensive list."
        },
        "eventData": {
          "bsonType": "object",
          "description": "Context-specific data for the event. Structure varies by eventType (see NOEMA_EVENT_CATALOG.md).",
          "additionalProperties": true
        },
        "sourcePlatform": {
          "bsonType": "string",
          "description": "Platform from which the event originated (e.g., telegram, discord, web, api)."
        }
      }
    }
    ```

### 7. `generationOutputs` Collection
*   **Description:** Stores detailed records of all generation tasks performed across all integrated services.
*   **Schema:**
    ```json
    {
      "bsonType": "object",
      "required": [
        "generationId",
        "masterAccountId",
        "sessionId",
        "initiatingEventId",
        "serviceName",
        "requestTimestamp",
        "status"
      ],
      "properties": {
        "generationId": {
          "bsonType": "objectId",
          "description": "Unique ID for this generation record (Primary Key)."
        },
        "masterAccountId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userCore._id."
        },
        "sessionId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userSessions.sessionId in which this generation was requested."
        },
        "initiatingEventId": {
          "bsonType": "objectId",
          "description": "Foreign Key to userEvents.eventId that triggered this generation."
        },
        "serviceName": {
          "bsonType": "string",
          "description": "Identifier for the generation service used (e.g., comfyui-deploy, dalle3-service)."
        },
        "platformSpecificRunId": {
          "bsonType": ["string", "null"],
          "description": "The unique run/job ID returned by the specific external generation platform."
        },
        "requestTimestamp": {
          "bsonType": "date",
          "description": "Timestamp when the generation request was initiated by our system to the service."
        },
        "responseTimestamp": {
          "bsonType": "date",
          "description": "Timestamp when the final response was received from the service. Null if still pending/processing or if it failed before response."
        },
        "durationMs": {
          "bsonType": "long",
          "description": "Total duration of the generation process in milliseconds. Calculated upon completion/failure."
        },
        "status": {
          "bsonType": "string",
          "description": "Final status of the generation task.",
          "enum": [
            "success",
            "failed",
            "cancelled_by_user",
            "timeout"
          ]
        },
        "costUsd": {
          "bsonType": "decimal",
          "description": "Cost of the generation in USD. Null if not applicable or not yet calculated."
        },
        "requestPayload": {
          "bsonType": "object",
          "description": "The specific payload sent to the generation service. Structure varies by serviceName.",
          "additionalProperties": true
        },
        "responsePayload": {
          "bsonType": "object",
          "description": "The response received from the generation service. Structure varies by serviceName and status.",
          "additionalProperties": true
        },
        "artifactUrls": {
          "bsonType": "array",
          "description": "A dedicated array to store direct URLs to generated artifacts.",
          "items": {
            "bsonType": "object",
            "properties": {
              "url": {"bsonType": "string"},
              "type": {"bsonType": "string", "description": "e.g., image, video, audio, text_file"}
            }
          }
        },
        "errorDetails": {
          "bsonType": "object",
          "description": "Structured details of the error if the generation failed.",
          "properties": {
            "errorCode": {"bsonType": "string"},
            "errorMessage": {"bsonType": "string"},
            "errorSource": {"bsonType": "string", "description": "e.g., noema_internal, service_api, user_input_validation"},
            "additionalContext": {"bsonType": "object", "additionalProperties": true}
          }
        },
        "metadata": {
          "bsonType": "object",
          "description": "Any other relevant metadata associated with the generation. Structure varies by serviceName.",
          "additionalProperties": true
        },
        "retryAttempt": {
            "bsonType": "int",
            "description": "If retries are implemented, this indicates the attempt number (e.g., 0 for initial, 1 for first retry)."
        }
      }
    }
    ```

## Consequences
*   These schemas provide a comprehensive and robust data model for `noema`.
*   Development effort will be required to implement database interaction logic for these schemas.
*   Data migration strategies for existing `stationthisbot` data will need to map to these new structures.
*   The `NOEMA_EVENT_CATALOG.md` must be maintained and kept in sync with development.

## Next Steps
*   Review and finalize this ADR.
*   Implement database interaction services (e.g., in `src/core/services/db/`) based on these schemas.
*   Continue to populate and refine `NOEMA_EVENT_CATALOG.md`.

---