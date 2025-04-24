# Phase 1: Core Services Status

## Overview
This document tracks the status of core services being extracted from the legacy codebase.

## Services

### 1. ComfyUI Service
**Status**: Not Started  
**Source Files**: `utils/bot/queue.js`, workflows from MongoDB  
**Target File**: `src/core/services/comfyui.js`  
**Dependencies**: None yet  
**Description**: Handles interactions with ComfyUI API for image generation  

### 2. Points Service
**Status**: Not Started  
**Source Files**: `utils/bot/points.js`  
**Target File**: `src/core/services/points.js`  
**Dependencies**: None yet  
**Description**: Manages user point balances, purchases, and transactions  

### 3. Workflows Service
**Status**: Not Started  
**Source Files**: `utils/bot/initialize.js`, workflow data in MongoDB  
**Target File**: `src/core/services/workflows.js`  
**Dependencies**: None yet  
**Description**: Manages loading and accessing available workflows  

### 4. Media Service
**Status**: Not Started  
**Source Files**: File handling in various command handlers  
**Target File**: `src/core/services/media.js`  
**Dependencies**: None yet  
**Description**: Handles media uploads, downloads, and transformations  

### 5. Session Service
**Status**: Not Started  
**Source Files**: Global `lobby` object in `utils/bot/bot.js`  
**Target File**: `src/core/services/session.js`  
**Dependencies**: None yet  
**Description**: Manages user sessions and preferences  

## Migration Notes
- Services should follow consistent patterns for error handling and logging
- Each service should be testable in isolation
- Avoid introducing new dependencies during the extraction phase 