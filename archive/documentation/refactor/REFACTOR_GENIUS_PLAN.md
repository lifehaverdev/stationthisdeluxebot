# REFACTOR GENIUS PLAN

## Purpose

This document defines the guiding principles, architecture, and collaboration process for continuing the StationThis refactor. Version 2 reflects a critical directional shift: from foundational infrastructure focus to demonstration-first, user-visible, human-reviewed iteration.

## Vision
We are building a real-time, creative, cross-platform AI assistant — not just code infrastructure. It must work for people, in front of people. The user experience is now the primary driver of system evolution.

## Core Principles
- **Practical over Perfect**: Prefer working solutions over perfect abstractions
- **Feature-First**: Prioritize working features over architectural elegance
- **Incremental Migration**: Maintain backward compatibility while refactoring
- **Revenue Focus**: Keep business logic intact throughout the refactor
- Demonstration-First: Each refactored component must be visibly working before further phases progress.
- Working demos, not documents, define forward momentum.

## Simplified Architecture

### 1. Core Services Layer
```
src/
  core/
    services/  
      comfyui.js        # ComfyUI service API
      points.js         # Points and balance management
      workflows.js      # Workflow management
      media.js          # Media handling
      session.js        # Simple session management
```

### 2. Platform-Agnostic Logic
```
src/
  workflows/  
    makeImage.js        # Image generation workflow
    trainModel.js       # Training workflow 
    collections.js      # Collection management
    settings.js         # User preferences
```

### 3. Platform Adapters
```
src/
  platforms/
    telegram/
      commands/         # Command handlers
      renderer.js       # Telegram-specific UI
      bot.js            # Telegram entry point
    discord/
      commands/         # Discord command handlers
      renderer.js       # Discord-specific UI
      bot.js            # Discord entry point
    web/
      routes/           # Web routes
      components/       # Web components
      app.js            # Web entry point
```

### 4. API Layer
```
src/
  api/
    internal/           # Internal APIs for inter-service communication
    external/           # External-facing APIs
```

### 5. Entry Points
```
/app.js
```

## Command Flow Example: /make

1. **Platform Input**: User sends `/make` with prompt text in Telegram
   ```
   platforms/telegram/commands/makeCommand.js receives command
   ```

2. **Command Handler**: Maps to appropriate workflow
   ```
   handler calls workflows/makeImage.js
   ```

3. **Workflow Logic**: Executes business logic steps
   ```
   workflow gets user preferences from session.js
   workflow calls services/comfyui.js to generate image
   ```

4. **Service Execution**: Handles external integration
   ```
   comfyui.js sends API request to ComfyUI
   points.js deducts points from user balance
   ```

5. **Platform Response**: Renders result in platform-specific format
   ```
   workflow returns result to telegram/renderer.js
   renderer formats as Telegram message with inline buttons
   ```


## Migration Strategy

While Phase 1–4 laid the architectural groundwork, we are now in:

Phase 5: Human-Centered Assembly

This phase is about building the real experience. The user (you) is now QA, UX, PM, and founder.

Only what’s reviewed and verified survives.

## Development Guidelines

1. **Start Small**: Begin with 1-2 core commands (e.g., `/make`)
2. **Test Constantly**: Ensure each refactored component works before proceeding
3. **Document Intent**: Add comments explaining business logic
4. **Keep Dependencies Minimal**: Avoid adding complexity through dependencies
5. **Maintain Feature Parity**: Ensure all existing features work in new architecture

## Success Metrics

New features work in the interface (not just in theory)

User has seen and signed off on each major feature

Handoff documents match reality

Features don’t drift — they snap into place via human eyes
