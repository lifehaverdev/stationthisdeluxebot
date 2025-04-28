# Database Overview

## High-Level Structure
The `db` folder contains the database layer of the application, with several key components:

1. **Models** - Schema and data access objects
2. **Operations** - Database utility scripts and operations
3. **Utils** - Supporting utilities for database interactions
4. **Root** - Core database files and connection management

## Models
The system uses MongoDB with several data models:

- **User Models**:
  - `userCore.js` - Core user information
  - `userPref.js` - User preferences
  - `userStats.js` - User activity statistics
  - `userEconomy.js` - User economic data (points, balance)

- **Content Models**:
  - `workspace.js` - Working space for LoRA generation
  - `loras.js` - LoRA model information
  - `workflows.js` - AI generation workflows
  - `studio.js` - Content creation studio data

- **Collection Models**:
  - `collection.js` - User collections
  - `loralist.js` - Lists of LoRA models
  - `floorplan.js` - Floorplan data structures

- **System Models**:
  - `BaseDB.js` - Base database operations class
  - `cache.js` - Caching mechanisms
  - `globalStatus.js` - System status tracking
  - `analyticsEvents.js` - Event tracking for analytics
  - `burns.js` - Token burn tracking

## Database Operations
The operations folder contains various utility scripts for database maintenance and management:

- **LoRA Management**:
  - `updateLoraCognates.js` - Update related LoRA terms
  - `updateLoraTags.js` - Update LoRA tags
  - `uploadLorasToMongo.js` - Upload LoRA data to MongoDB
  - `downloadLora.js` - Download LoRA data
  - `enrichLoras.js` - Enhance LoRA metadata
  - `fixLoraTriggers.js` - Fix LoRA trigger words
  - `compareLoraData.js` - Compare LoRA datasets
  - `addLoraTimestamps.js` - Add timestamps to LoRA data

- **Collection Management**:
  - `exportCollection.js` - Export collections
  - `downloadCollection.js` - Download collections
  - `uploadToSpaces.js` - Upload to Huggingface Spaces

- **User Management**:
  - `userFetch.js` - Fetch user data
  - `migrateUsers.js` - Migrate user data
  - `repairUsers.js` - Fix corrupted user data
  - `auditUsers.js` - Audit user accounts
  - `newUser.js` - Create new users
  - `batchPoints.js` - Batch update user points

- **System Operations**:
  - `clearStudio.js` - Clear studio data
  - `initGlobalStatus.js` - Initialize global status
  - `downloadGens.js` - Download generated content

## Utility Functions
The utils folder provides supporting functionality:

- `queue.js` - Queue system for database operations with priority handling
- `validation.js` - Data validation (empty file, placeholder)
- `monitoring.js` - System monitoring (empty file, placeholder)

## Root Database Files
Key files at the root of the db folder:

- `index.js` - Main exports for database models
- `mongodb.js` - Legacy MongoDB client implementation (1900+ lines)
- `mongoWatch.js` - MongoDB change stream monitor
- `mongoCheck.js` - Database integrity checking tool
- `training.js` - LoRA training management
- `addLora.js` - Utility for adding LoRAs to the database
- `addWorkflow.js` - Utility for adding workflows
- `events.js` - Event emitter for database events
- `updatedb.js` - Database update utility

## Tight Coupling Points
Several files have tight coupling to other parts of the system:

1. **Bot Integration**:
   - `mongodb.js` imports `lobby` and `workspace` directly from `../utils/bot/bot`
   - `training.js` has hard-coded paths for file operations

2. **Telegram Dependency**:
   - Many database operations are tied to Telegram user IDs
   - The global `lobby` object is referenced in multiple places

3. **Environment Configuration**:
   - Hard dependencies on environment variables like `BOT_NAME` and `MONGO_PASS`

4. **File System Operations**:
   - Direct file system operations in many scripts without abstraction

## Operator/Dev Scripts
Scripts intended for operators or developers:

1. **Admin Tools**:
   - `mongoCheck.js` - Database health check and diagnostics
   - `training.js` - CLI tool for managing LoRA training
   - `updatedb.js` - Database migration and updates

2. **Data Management**:
   - Operations scripts for importing/exporting data
   - Scripts in `operations/` folder like `migrateUsers.js`, `uploadToSpaces.js`

3. **Maintenance**:
   - `repairUsers.js` - Fix corrupted user data
   - `auditUsers.js` - Audit and validate user accounts

## Migration Considerations
For the Phase 2 refactoring:

1. **Decouple from Telegram**:
   - Separate user identity from Telegram-specific IDs
   - Remove direct dependencies on `lobby` global state

2. **Improve Architecture**:
   - Replace direct MongoDB operations with internal API
   - Create clear separation between data models and access patterns

3. **Standardize Error Handling**:
   - Implement consistent error handling across database operations
   - Add proper logging and monitoring

4. **Enhance Security**:
   - Improve validation for all database inputs
   - Add proper access control and authentication

5. **Optimize Performance**:
   - Evaluate and improve the queue system
   - Implement proper indexes and query optimization 