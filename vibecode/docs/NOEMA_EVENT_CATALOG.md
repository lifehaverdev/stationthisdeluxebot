# Noema Event Catalog

## 1. Introduction

This document serves as the definitive catalog for all event types (`eventType`) logged within the Noema system. Each event logged into the `userEvents` collection must conform to one of the `eventType` definitions specified here. This catalog details the `eventType` string and the expected schema for its corresponding `eventData` object.

**Purpose:**
*   Ensure consistency in event logging across all Noema services and platforms.
*   Provide a clear reference for developers on what data to log for each event.
*   Facilitate data analysis and interpretation by defining the structure of event payloads.

**Related Schemas:**
*   `userEvents` collection schema (defined in `ADR-002-NoemaCoreDataSchemas.md`)

## 2. Event `eventData` Schema Guidelines

*   All `eventData` objects should be JSON objects.
*   Fields should be camelCased.
*   Timestamps within `eventData` (if any, beyond the main event `timestamp`) should be in ISO 8601 format.
*   Be as granular as necessary but avoid excessive nesting where possible.
*   Clearly indicate required vs. optional fields within each `eventData` schema.

## 3. Event Type Definitions

### 3.1 User Authentication & Session Events

#### 3.1.1 `user_login_success`
*   **Description:** Logged when a user successfully authenticates and a new session is initiated.
*   **`eventData` Schema:**
    ```json
    {
      "loginMethod": "string", // e.g., "password", "telegram_auth", "discord_auth", "wallet_signature", "api_key"
      "platform": "string" // e.g., "web", "telegram", "discord", "api_v1" (matches userSessions.platform)
      // Potentially add: "ipAddress": "string", "userAgent": "string" if not fully captured in userSessions or if more specific context is needed here.
    }
    ```

#### 3.1.2 `user_login_failed`
*   **Description:** Logged when a user authentication attempt fails.
*   **`eventData` Schema:**
    ```json
    {
      "loginAttemptIdentifier": "string", // e.g., username, telegram_user_id (whatever was used for the attempt)
      "failureReason": "string", // e.g., "invalid_credentials", "account_locked", "invalid_api_key", "signature_verification_failed"
      "platform": "string"
    }
    ```

#### 3.1.3 `user_logout`
*   **Description:** Logged when a user explicitly logs out or their session is terminated by such an action.
*   **`eventData` Schema:**
    ```json
    {
      "logoutReason": "string" // e.g., "user_initiated", "admin_initiated" (supplements userSessions.endReason)
    }
    ```

#### 3.1.4 `session_started`
*   **Description:** Logged when a new user session record is created in `userSessions`. Often coincides with `user_login_success`.
*   **`eventData` Schema:** (Potentially minimal if most data is in `userSessions`, but can include context)
    ```json
    {
        "platform": "string", // Redundant with userSessions but good for direct event query
        "startMethod": "string" // e.g., "login", "api_key_usage", "new_connection"
    }
    ```

#### 3.1.5 `session_ended`
*   **Description:** Logged when a user session record is marked as ended in `userSessions`.
*   **`eventData` Schema:**
    ```json
    {
        "endReason": "string", // Matches userSessions.endReason, for direct event query
        "durationMs": "long" // Duration of the session that just ended
    }
    ```

### 3.2 Command Execution Events

#### 3.2.1 `command_executed`
*   **Description:** Logged when a user executes a system command.
*   **`eventData` Schema:**
    ```json
    {
      "commandName": "string", // e.g., "/make", "/set_preference", "/view_balance"
      "args": "object | array | string", // Flexible to store command arguments or parameters
      "success": "boolean", // True if the command was accepted and initiated, false if rejected due to validation, permissions etc.
      "executionTimeMs": "long", // For synchronous commands, time taken to complete the core logic. For async, time to acknowledge/queue.
      "source": "string" // e.g., "chat_input", "menu_click", "api_call"
    }
    ```

#### 3.2.2 `command_failed_validation`
*   **Description:** Logged specifically when a command fails input validation before execution.
*   **`eventData` Schema:**
    ```json
    {
      "commandName": "string",
      "args": "object | array | string",
      "validationErrors": [ // Array of error details
        {
          "field": "string", // Optional, if error is specific to a field
          "message": "string" // Validation error message
        }
      ]
    }
    ```

### 3.3 Generation Lifecycle Events

#### 3.3.1 `generation_requested`
*   **Description:** Logged when a user initiates a request for a generative task.
*   **`eventData` Schema:**
    ```json
    {
      "serviceName": "string", // e.g., "comfyui-deploy", "dalle3-service"
      "requestParameters": "object", // Key parameters of the request, e.g., { "prompt": "A cat", "aspectRatio": "16:9" }
      "estimatedCostUsd": "decimal" // Optional: an estimated cost before actual generation
    }
    ```

#### 3.3.2 `generation_completed`
*   **Description:** Logged when a generative task completes successfully and the primary output is available. This event links to the `generationOutputs` record.
*   **`eventData` Schema:**
    ```json
    {
      "generationId": "objectId", // Foreign Key to generationOutputs.generationId
      "serviceName": "string",
      "durationMs": "long", // Actual duration from generationOutputs
      "costUsd": "decimal", // Actual cost from generationOutputs
      "status": "string", // Should be "success"
      "artifactCount": "integer" // e.g., number of images generated
      // Optionally include key output metadata here if frequently queried with events, like primary artifact URL
    }
    ```

#### 3.3.3 `generation_failed`
*   **Description:** Logged when a generative task fails. This event links to the `generationOutputs` record.
*   **`eventData` Schema:**
    ```json
    {
      "generationId": "objectId", // Foreign Key to generationOutputs.generationId (if record was created)
      "serviceName": "string",
      "durationMs": "long", // Optional, duration until failure
      "costUsd": "decimal", // Optional, cost incurred before failure
      "status": "string", // Should be "failed", "timeout", etc. from generationOutputs status
      "errorSource": "string", // e.g., "service_api", "internal_queue", "content_moderation"
      "errorCode": "string", // Optional: service-specific or internal error code
      "errorMessage": "string" // Optional: error message
    }
    ```

### 3.4 UI Interaction Events

#### 3.4.1 `menu_item_clicked`
*   **Description:** Logged when a user clicks an item in a menu.
*   **`eventData` Schema:**
    ```json
    {
      "menuName": "string", // e.g., "main_menu", "lora_selection_menu"
      "itemId": "string", // Unique identifier for the clicked item within that menu
      "itemLabel": "string", // User-visible label of the item
      "actionType": "string" // e.g., "navigate", "execute_command", "open_sub_menu", "apply_setting"
    }
    ```

#### 3.4.2 `ui_element_interacted`
*   **Description:** Generic event for interactions with other UI elements not covered by `menu_item_clicked` (e.g., buttons, sliders, input fields after blur/change).
*   **`eventData` Schema:**
    ```json
    {
      "elementId": "string", // Unique identifier for the UI element
      "elementType": "string", // e.g., "button", "slider", "text_input", "checkbox"
      "interactionType": "string", // e.g., "click", "change", "submit", "focus", "blur"
      "currentValue": "any", // Optional: The value of the element after interaction (e.g., slider value, input text)
      "context": "string" // Optional: e.g., "image_editor_panel", "user_profile_settings"
    }
    ```

### 3.5 Error & System Events

#### 3.5.1 `user_facing_error_displayed`
*   **Description:** Logged when an error message (not necessarily a system crash) is displayed to the user.
*   **`eventData` Schema:**
    ```json
    {
      "errorType": "string", // Categorization of the error, e.g., "validation_error", "api_error", "resource_limit_exceeded", "payment_failed"
      "errorCode": "string", // Optional: A more specific internal or service error code
      "errorMessage": "string", // The message shown to the user
      "severity": "string", // e.g., "info", "warning", "error"
      "component": "string", // Which part of the system originated/displayed the error (e.g., "ImageGenerationWorkflow", "PaymentService")
      "context": "object" // Optional: Additional contextual data about the error state
    }
    ```

---

*More event types for account management (profile update, preference change), economy (credit added), awards (award_achieved), etc., will be added here.* 