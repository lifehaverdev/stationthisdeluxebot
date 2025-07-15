HANDOFF: 2024-07-09 (Updated 2024-07-15)

### Work Completed
- Implemented a fullscreen text overlay for editing prompt fields, modeled after the image overlay.
- Refactored overlay logic into `src/platforms/web/client/src/sandbox/node/overlays/textOverlay.js`.
- Moved overlay binding logic from `DOMContentLoaded` to the `createToolWindow` function to support dynamically rendered tool windows.
- Updated event binding logic to use the `data-param-name` attribute for robustly targeting prompt input fields (`input_prompt`, `input_negative`, etc.).
- Added debug logging to trace the binding process and exposed `showTextOverlay` to the `window` object for easier manual testing.
- Restored user-friendly placeholders for input fields while using the `data-param-name` for internal logic.

### Current State
- **Resolved:** The text overlay is now fully functional.
- The overlay correctly appears when focusing on text input fields designated for prompts (e.g., `input_prompt`, `input_text`).
- The binding logic correctly handles tool windows that are created dynamically.

### Summary of Fix
The issue was twofold:
1.  The binding logic was only running on `DOMContentLoaded`, so it missed dynamically created tool windows.
2.  The initial attempt to bind to input fields relied on `placeholder` attributes, which were not reliable as they contained user-facing descriptions.

The fix involved:
1.  Calling `bindPromptFieldOverlays()` at the end of the `createToolWindow()` function in `toolWindow.js`.
2.  Changing the selector logic in `bindPromptFieldOverlays()` to use the `data-param-name` attribute, which provides a stable hook for identifying the correct inputs.