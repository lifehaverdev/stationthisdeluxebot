/**
 * Debug configuration for sandbox client
 * Toggle verbose logging on/off for different components
 */

// Debug flags - set to false to disable verbose logging
export const DEBUG_FLAGS = {
    // UI interaction logs
    CLICK_HANDLER: false,           // [CLICK HANDLER] logs
    UPDATE_FAB: false,              // [updateFAB] selection logs
    TEXT_OVERLAY: false,            // [textOverlay.js] binding logs
    
    // Tool execution logs
    TOOL_WINDOW_ADAPTER: false,     // [node.js] [ADAPTER] createToolWindow logs
    TOOL_EXECUTION: false,          // [node.js] Execute button clicked logs
    EXECUTION_RESULT: false,        // [DEBUG] Normalised execution result logs
    
    // WebSocket logs
    WEBSOCKET_PROGRESS: false,      // [Sandbox] Generation progress received logs
    WEBSOCKET_DEBUG_PROGRESS: false, // [DEBUG progress] map keys logs
    WEBSOCKET_UPDATE: false,        // [WS] generationUpdate received logs
    WEBSOCKET_RENDER: false,        // [WS] Rendering output logs
    
    // Image overlay logs
    IMAGE_OVERLAY_SHOW: false,      // [DEBUG] showImageOverlay logs
    IMAGE_OVERLAY_HIDE: false,      // [DEBUG] hideImageOverlay logs
    IMAGE_OVERLAY_SIZES: false,     // [DEBUG] overlay size logs
    
    // Cost tracking logs
    COST_TRACKING: false,           // [Cost] logs
    COST_EXCHANGE_RATES: false,     // [Cost] Using real-time exchange rates logs
};

// Helper function to check if a debug flag is enabled
export function isDebugEnabled(flag) {
    return DEBUG_FLAGS[flag] === true;
}

// Helper function to conditionally log
export function debugLog(flag, ...args) {
    if (isDebugEnabled(flag)) {
        console.log(...args);
    }
}

// Helper function to conditionally warn
export function debugWarn(flag, ...args) {
    if (isDebugEnabled(flag)) {
        console.warn(...args);
    }
}
