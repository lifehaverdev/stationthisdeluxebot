# iDirect.js Plan

## Current Purpose
`iDirect.js` implements a storyboard and scene development system for creating a sequence of related images. It guides users through developing a narrative concept, breaking it into key scenes, refining visual details for each scene, and generating appropriate prompts for image creation. This creates a cohesive visual story rather than individual images.

## Exported Functions/Classes
- **Command Handlers**:
  - `/direct` handler - Initiates a new storyboard development session

- **State Handlers**:
  - `stateHandlers['direct']` - Processes user responses during story development
  - `stateHandlers['direct_scene']` - Processes user responses during scene development

- **Action Handlers**:
  - `actionMap['direct_skip']` - Skips to storyboard generation
  - `actionMap['direct_scene_skip']` - Skips to scene prompt generation
  - `actionMap['direct_scene_select']` - Selects a scene to develop
  - `actionMap['direct_create']` - Creates images from scene prompts
  - `actionMap['direct_reset']` - Resets the storyboard session

- **Helper Functions**:
  - `showThinking(message, customText)` - Shows thinking indicator
  - `ledgerOps.initializeScene(userId, sceneIndex)` - Initializes scene data
  - `ledgerOps.addToHistory(userId, sceneIndex, entry)` - Adds to scene history
  - `createStoryboardMenu(storyboard)` - Creates scene selection UI

- **Template Functions**:
  - `gptTemplates.storyDevelopment(seedText)` - Template for story development
  - `gptTemplates.storyEvaluation(seed, history)` - Template for evaluating story readiness
  - `gptTemplates.storyboardGeneration(summary)` - Template for generating storyboard
  - `gptTemplates.sceneDevelopment(scene)` - Template for developing scene details
  - `gptTemplates.sceneEvaluation(scene, history)` - Template for evaluating scene readiness
  - `gptTemplates.fluxPromptGeneration(scene, history, skipMode)` - Template for prompt generation

## Dependencies and Integrations
- Relies on global `ledger` object for session state management
- References global objects like `lobby`, `commandRegistry`, etc.
- External AI capabilities via `gptAssist` from assist module
- Image generation via `handleFlux` from iMake.js
- Telegram-specific UI through buttons and message handling
- Utility functions for message sending and state management

## Identified Issues
- Uses a global `ledger` object instead of proper session storage
- Direct coupling with Telegram message format
- Tight integration with specific AI models like GPT-4
- Hard-coded prompts and system messages
- Limited error handling and recovery options
- No persistence of storyboard sessions beyond runtime
- Complex state management within the handlers
- No separation between narrative logic and UI

## Migration Plan
1. Create `src/core/storyboard/`:
   - `engine.js` - Core storyboard creation logic
   - `scene.js` - Scene development logic
   - `repository.js` - Session storage and retrieval
   - `templates.js` - System prompts and templates

2. Create `src/core/narrative/`:
   - `director.js` - Narrative flow management
   - `evaluator.js` - Story and scene quality assessment
   - `generator.js` - Storyboard and scene generation

3. Create `src/integrations/telegram/direct.js`:
   - Telegram-specific command handler
   - UI components for the storyboard flow
   - Button actions and callback handling

4. Implement `src/api/storyboard.js`:
   - Internal API for storyboard creation
   - Session management endpoints
   - Scene and prompt generation endpoints

5. Suggested improvements:
   - Implement proper database storage for storyboard sessions
   - Create a configurable template system for prompts
   - Add support for different AI models and providers
   - Implement proper error handling and recovery
   - Create a session timeout and cleanup mechanism
   - Add analytics for tracking storyboard quality
   - Implement user feedback collection for scenes
   - Create a shareable storyboard library
   - Add support for different narrative structures
   - Implement media types beyond images (video sequences, etc.) 