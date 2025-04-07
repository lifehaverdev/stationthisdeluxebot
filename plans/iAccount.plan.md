# iAccount.js Plan

## Current Purpose
`iAccount.js` manages user account functionality within the bot, including account settings, preferences, balances, points/qoints management, verification, API key management, and UI for displaying account information. It serves as the central hub for users to interact with their account data.

## Exported Functions/Classes
- **Account UI Functions**:
  - `displayAccountSettingsMenu(message, dms)` - Shows account settings menu
  - `returnToAccountMenu(message, user)` - Returns to account menu
  - `buildAccountSettingsKeyboard(userId)` - Creates account keyboard UI
  - `buildUserProfile(message, dms)` - Builds user profile display

- **Preferences Management**:
  - `accountPreferencesMenu(message, user)` - Displays preferences menu
  - `buildPreferencesKeyboard(userId)` - Creates preferences keyboard UI
  - `handleSaveSettings(message)` - Saves user settings
  - `handleSeeSettings(message)` - Shows user settings

- **API Key Management**:
  - `handleApiKeyManagement(message, user)` - Manages API key generation/refresh
  - `handleShowApiKey(message, user)` - Shows user API key
  - `handleRefreshApiKey(message, user)` - Refreshes API key

- **Authentication & Verification**:
  - `handleSignIn(message)` - Handles user sign in
  - `handleVerify(message)` - Handles wallet verification
  - `updateUserVerificationStatus(userId, user)` - Updates verification status
  - `handleSignOut(message)` - Handles user sign out
  - `isHashValid(wallet, salt, providedHash)` - Validates verification hash

- **Command Management**:
  - `commandListMenu(message, page, user)` - Shows command list menu
  - `buildCommandListMenu(message, page, user, pageSize)` - Builds command list UI
  - `buildCommandButtons(user, command, index)` - Creates command buttons
  - `handleCommandListEdit(message, user, index, command)` - Edits command list

- **Points Management**:
  - `handleRefreshQoints(message, user)` - Refreshes user points
  - `createBalancedBar(totalPossiblePoints, spentPoints, qoints, segments)` - Visual points display

## Dependencies and Integrations
- Tightly coupled with Telegram bot UI and message handling
- References global state via `lobby`, `rooms`, etc.
- Database integrations:
  - `UserEconomy`, `UserCore`, `UserPref`, `FloorplanDB` models
  - `fetchUserCore`, `fetchFullUserData` operations
  - `writeNewUserDataMacro` for new users
- External integrations:
  - Crypto APIs for wallet verification
  - Analytics tracking
- Internal dependencies:
  - `TutorialManager` from iStart.js
  - Various utility functions
  - Features model for token-gated features

## Identified Issues
- Telegram-specific UI mixed with core account logic
- Direct references to global state objects (`lobby`)
- Mixing of authentication logic with UI rendering
- Complex validation and state management embedded in UI handlers
- Lack of clear separation between data access, business logic, and presentation
- No proper error handling or validation
- Duplicated functionality across functions
- Hard-coded UI elements and text

## Migration Plan
1. Create `src/core/account/`:
   - `model.js` - Core account data models
   - `service.js` - Business logic for account operations
   - `preferences.js` - User preferences management
   - `authentication.js` - Authentication and verification logic
   - `points.js` - Points calculation and management
   - `apiKey.js` - API key generation and validation

2. Create `src/integrations/telegram/account.js`:
   - Telegram-specific UI for account management
   - Command handlers for account-related commands
   - Message and callback handling for account interactions

3. Implement `src/api/account.js`:
   - Internal API for account operations
   - Authentication and authorization endpoints
   - User preferences and settings management
   - Points management endpoints

4. Suggested improvements:
   - Implement proper authentication flow with JWT tokens
   - Create a state management system for UI interactions
   - Separate account data storage from UI state
   - Implement proper validation for all user inputs
   - Create consistent error handling
   - Implement logging for account operations
   - Use dependency injection for external services 