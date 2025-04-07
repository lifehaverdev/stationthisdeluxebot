# iCollection.js Plan

## Current Purpose
`iCollection.js` manages the collection mode functionality of the bot, allowing users to organize, curate, and interact with collections of generated images. It handles collection creation, image management, sharing, and various collection-related commands and workflows.

## Exported Functions/Classes
- **Collection Management Functions**:
  - `createCollection(message, name, description)` - Creates a new collection
  - `addToCollection(message, collectionId, imageId)` - Adds image to collection
  - `removeFromCollection(message, collectionId, imageId)` - Removes image from collection
  - `deleteCollection(message, collectionId)` - Deletes a collection
  - `renameCollection(message, collectionId, newName)` - Renames a collection
  - `updateCollectionDescription(message, collectionId, newDesc)` - Updates description

- **Collection Viewing Functions**:
  - `listUserCollections(message, userId)` - Lists user's collections
  - `viewCollection(message, collectionId, page)` - Views a collection
  - `viewCollectionDetails(message, collectionId)` - Views collection details
  - `searchCollections(message, query)` - Searches collections

- **Collection Sharing Functions**:
  - `shareCollection(message, collectionId)` - Shares a collection
  - `makeCollectionPrivate(message, collectionId)` - Makes collection private
  - `makeCollectionPublic(message, collectionId)` - Makes collection public
  - `addCollaborator(message, collectionId, userId)` - Adds collaborator to collection

- **Collection Mode UI Functions**:
  - `showCollectionModeMenu(message, user)` - Shows collection mode menu
  - `showCollectionActionMenu(message, collectionId)` - Shows collection actions
  - `buildCollectionUI(collection)` - Builds collection UI
  - `buildCollectionImageUI(collectionId, images, page)` - Builds image gallery UI

- **Collection Workflow Functions**:
  - `startCollectionFlow(message, user)` - Starts collection creation flow
  - `handleCollectionNameInput(message)` - Handles collection name input
  - `handleCollectionDescInput(message)` - Handles description input
  - `handleCollectionModeExit(message)` - Exits collection mode

## Dependencies and Integrations
- Telegram bot API for message handling and UI
- Database operations for collection storage
- References to global state objects
- File system operations for image storage
- Shared utility functions for message handling
- User authentication and authorization

## Identified Issues
- Telegram-specific UI mixed with core collection logic
- Direct references to global state objects
- Complex workflows with many steps and states
- Mixed responsibilities: data management, UI, user interaction
- Limited error handling
- No clear separation between data access and business logic
- Hard-coded UI elements and text
- Collection sharing permissions not well-defined

## Migration Plan
1. Create `src/core/collection/`:
   - `model.js` - Core collection data models
   - `service.js` - Business logic for collection operations
   - `repository.js` - Data access layer for collections
   - `permission.js` - Permission management for collections
   - `search.js` - Collection search functionality

2. Create `src/integrations/telegram/collection.js`:
   - Telegram-specific UI for collections
   - Collection command handlers
   - Collection flow management

3. Implement `src/api/collection.js`:
   - Internal API for collection operations
   - Collection CRUD endpoints
   - Sharing and permission endpoints
   - Search endpoints

4. Create `src/core/image/`:
   - `repository.js` - Image data access
   - `service.js` - Image management functions

5. Suggested improvements:
   - Implement a proper permission system for collections
   - Create a workflow engine for collection operations
   - Add robust error handling and validation
   - Implement proper logging and monitoring
   - Create a clear separation between collection data and UI
   - Add search indexing for efficient collection searching
   - Implement pagination for large collections
   - Create a sharing system with fine-grained permissions
   - Add analytics for collection usage and engagement 