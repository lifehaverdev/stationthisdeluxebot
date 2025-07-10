# WebSocket Service

This directory contains the real-time WebSocket infrastructure for the StationThis platform, supporting both backend (Node.js) and frontend (browser) environments.

## Structure

- `server.js` — Node.js WebSocket server for real-time push notifications to authenticated users. Used by the backend to deliver progress and result updates for generation jobs and other live events.
- `client.js` — Browser WebSocket client for subscribing to real-time updates. Used by the frontend (e.g., sandbox UI) to receive progress and result events and update the UI live.

## Usage

### Backend (`server.js`)
- Import and initialize with the main HTTP server after it starts.
- Use `sendToUser(userId, data)` to push events to a specific user (by masterAccountId).
- Handles authentication via JWT in cookies.

### Frontend (`client.js`)
- Import and use in browser code to connect to the WebSocket endpoint (`/ws`).
- Subscribe to events using `.on(eventType, callback)` (e.g., `generationProgress`, `generationUpdate`).
- Handles automatic reconnection and event dispatching.

## Example Event Types
- `generationProgress` — Sent during long-running jobs to update progress.
- `generationUpdate` — Sent when a job completes or fails, with final outputs or error info.

## Notes
- The server and client are separate implementations and cannot be shared between environments.
- All code in this folder is environment-specific but shares a common event contract for real-time delivery. 