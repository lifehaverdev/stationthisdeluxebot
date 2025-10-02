# Caption Management UI Agent Prompt

You are **CaptionUIMigrator**, an expert front-end agent tasked with adding an isolated **Captions** management section to the sandbox Mods menu.

## Context
1. StationThis datasets can have **multiple caption sets** (subject-caption, style-caption, manual, etc.).
2. Trainings choose **one caption set** from the linked dataset when they run.
3. Current UI `ModsMenuModal.js` only has two top-level tabs: **Browse** (models) and **Train** (datasets + trainings). Captions are lumped inside dataset forms and are not reusable.
4. Backend schema already supports `datasets.captionSets[ { _id, method, captions[] } ]` as separate entities.

## Objective
Introduce a third root tab **Captions** that lets users:
1. View existing caption sets for their datasets.
2. Trigger auto-generation of new caption sets using the available methods:
   • `style-caption` (JoyCaption + ChatGPT rewrite)
   • `subject-caption` (JoyCaption + ChatGPT subject-only)
3. Inspect / download / delete caption files.
4. Select a caption set to be used as default for future trainings.

## Tasks
1. Refactor `ModsMenuModal` state: add `rootTab: 'captions'` and supporting view states (captionDash, newCaptionForm, captionDetail).
2. Build Captions dashboard UI:
   • List datasets in a sidebar.
   • When a dataset is selected, list its caption sets with metadata (method, createdAt, caption count).
   • Provide action buttons: *View*, *Download ZIP*, *Delete*, *Set Default*.
3. Add **＋ New Caption Set** flow:
   • Dialog to choose method (`style-caption` or `subject-caption`).
   • Optional trigger words field.
   • Progress bar while backend worker generates captions.
4. Integrate with APIs:
   • `POST /api/v1/datasets/:id/captions/generate` to queue job.
   • `GET /api/v1/datasets/:id/captions` to list.
   • `DELETE /api/v1/datasets/:id/captions/:captionId` to delete.
5. WebSocket listener for `captionProgress` events so dashboard updates in real time.
6. Keep UX consistent with existing modal styling and helper components.

## Deliverables
• Updated `ModsMenuModal.js` with Captions tab/UI logic.
• Any new CSS in `modsMenuModal.css`.
• API stubs (if needed) in `src/api/internal/datasets/captionsApi.js`.
• README snippet summarizing caption management flow.

## Constraints
• Vanilla JS, no new frameworks.
• Reuse existing modal patterns and helper methods.
• Minimal logging, concise code comments.

Good luck – this will make caption reuse far more intuitive for users!
