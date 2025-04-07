# iLora.js Plan

## Current Purpose
`iLora.js` manages the LoRA (Low-Rank Adaptation) model functionality of the bot, allowing users to browse, search, and use various AI image generation models. It provides a user interface for discovering LoRA models by category, viewing details, favoriting models, and implementing search functionality.

## Exported Functions/Classes
- **Command Handlers**:
  - `/loras` handler: `displayLoraMenu` - Shows the main LoRA category menu
  - `/loralist` handler: Legacy command that redirects to `/loras`

- **UI Functions**:
  - `displayLoraMenu(message, user, category)` - Displays the main LoRA menu
  - `displayLoraCategory(message, category, user, page)` - Shows LoRAs in a category
  - `handleLoraCallback(message, category, user)` - Processes LoRA menu callbacks
  - `displaySubcategories(message, primaryTag, user)` - Shows subcategories
  - `displayLorasByTag(message, primaryTag, secondaryTag, user)` - Filtered LoRAs
  - `displayRecentLoras(message, user)` - Shows recent LoRAs
  - `displayFavorites(message, user)` - Shows user's favorite LoRAs
  - `displayPopularLoras(message, user)` - Shows popular LoRAs
  - `displayLoraDetail(message, loraName, user)` - Shows detailed info for a LoRA

- **Utility Functions**:
  - `handleLoraRate(message, loraName, rating, user)` - Handles rating LoRAs
  - `handleLoraRequest(message, user)` - Handles model requests
  - `handleLoraSearch(message)` - Handles search functionality
  - `getTagCounts(loras, primaryTag)` - Gets tag statistics
  - `getSecondaryTags(primaryTag)` - Gets related tags
  - `getLoraDisplayName(lora)` - Formats LoRA name for display
  - `getUntaggedLoras(primaryTag, relevantLoras, significantTags)` - Finds untagged models
  - `isLoraFavorited(user, loraName)` - Checks if a LoRA is favorited

## Dependencies and Integrations
- Tightly coupled with Telegram bot API for message handling and UI
- Uses `sendMessage`, `editMessage`, etc. from utils
- References global objects: `lobby`, `commandRegistry`, `prefixHandlers`, etc.
- Database integration via `Loras` model
- File system operations for handling LoRA metadata
- Assumes existence of global `loraTriggers` object

## Identified Issues
- Telegram-specific UI logic mixed with core LoRA functionality
- Heavy reliance on global state and objects
- Lacks clear separation between data access, business logic, and presentation
- Message handling and UI generation tightly coupled
- No clear error handling strategy
- Hard-coded pagination and display logic
- No proper model for LoRA data

## Migration Plan
1. Create `src/core/lora/`:
   - `model.js` - Core LoRA model definition and operations
   - `repository.js` - Data access layer for LoRA models
   - `service.js` - Business logic for searching, categorizing, and managing LoRAs
   - `favorites.js` - Functionality for managing favorite LoRAs

2. Create `src/integrations/telegram/lora.js`:
   - Telegram-specific UI for LoRA browsing and selection
   - Command handlers for LoRA-related commands
   - Callback handling for interactive LoRA selection

3. Implement `src/api/lora.js`:
   - Internal API for LoRA operations
   - Endpoints for browsing, searching, and managing LoRAs
   - Interface for frontend applications

4. Suggested improvements:
   - Implement proper data models for LoRAs
   - Create a caching layer for frequently accessed LoRA data
   - Implement pagination through a reusable component
   - Add proper error handling and user feedback
   - Create a search index for more efficient LoRA search
   - Add metrics for popular and frequently used LoRAs
   - Implement proper validation for user input 