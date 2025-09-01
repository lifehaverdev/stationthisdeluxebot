# Supporting Input UX — Outline

## Problem Statement
Current generation workflows that require supporting images (style, control, depth, etc.) are treated the same as simple text-to-image or img2img flows. Users are not guided to supply the extra assets, resulting in failed runs or confusing errors inside Telegram and web clients.

## Vision
Deliver an intuitive multi-step UX that:
1. Detects when a workflow needs additional supporting images beyond the main prompt & main image.
2. Prompts the user to attach those images (via file caption, subsequent message, or inline buttons) before dispatching the job.
3. Shows clear progress and highlights which inputs are still missing.
4. Works consistently across Telegram, web sandbox, and future Discord integration.

## Acceptance Criteria
- [ ] Bot identifies supporting-image requirements from `platformHints.supportingImageInputs` emitted by WorkflowCacheManager.
- [ ] When requirements are unmet, bot asks for missing assets with explicit labels (e.g. “Please send a *style image*”).
- [ ] User can satisfy each requirement via photo upload or URL; the bot confirms receipt.
- [ ] UX completes within ≤ 3 exchange turns in 95 % of real-world tests.
- [ ] End-to-end test suite covers text-only workflows, img2img, and style/control workflows.

## Key Milestones
| Milestone | Description | Target Sprint |
|-----------|-------------|---------------|
| Detection Logic | Expose supporting-image flags via WorkflowCacheManager | 2025-09-01 |
| Telegram UX Prototype | Implement multi-turn prompting for missing images | 2025-09-03 |
| Modular InputCollector Component | Extract reusable helper for collecting additional inputs across commands | 2025-09-04 |
| Web Sandbox Update | Drag-&-drop slots for supporting images | 2025-09-05 |
| Integration Tests | Add unit & integration tests for new flows | 2025-09-06 |
| Documentation & ADR | Record design decisions, update guides | 2025-09-07 |

## Dependencies
- Updated `workflowUtils` & `workflowCacheManager` (done)
- Telegram bot middleware for session state
- Web client file-upload component
- Storage service for transient image blobs

## Implementation Notes
- Use `platformHints.supportingImageInputs` to dynamically build the prompt list.
- **Modular InputCollector**: new helper under `src/platforms/telegram/components/inputCollector.js` coordinates asking for and receiving missing inputs; reusable by any command handler.
- Session state per chat tracks which inputs are still missing.
- Consider inline buttons “Skip Style Image” only when `required=false` (future).
- File caption strategy: encourage users to attach multiple images in one message when possible.
