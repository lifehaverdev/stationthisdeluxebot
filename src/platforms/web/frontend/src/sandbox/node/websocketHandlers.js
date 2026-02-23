import { websocketClient } from '../ws.js';
import { untrackPendingGeneration } from '../state.js';
import { debugLog } from '../config/debugConfig.js';

// --- Generation Completion Manager ---
// Used by SandboxCanvas._awaitCompletion() to resolve pending generation promises.
const generationCompletionManager = {
    promises: new Map(),

    createCompletionPromise(generationId) {
        let resolver;
        const promise = new Promise(resolve => {
            resolver = resolve;
        });
        this.promises.set(generationId, { promise, resolver });
        return promise;
    },

    resolveCompletionPromise(generationId, result) {
        if (this.promises.has(generationId)) {
            this.promises.get(generationId).resolver(result);
            this.promises.delete(generationId);
        }
    }
};
export { generationCompletionManager };

/**
 * Handles the final result update from the WebSocket.
 * Resolves the completion promise used by SandboxCanvas._awaitCompletion().
 */
export function handleGenerationUpdate(payload) {
    const { generationId, outputs, status, castId, cookId, costUsd } = payload;

    // Ignore cook-driven tool updates (cookId present but no castId — backend only)
    if (cookId && !castId) return;

    debugLog('WEBSOCKET_UPDATE', '[WS] generationUpdate received', { generationId, status, costUsd });

    generationCompletionManager.resolveCompletionPromise(generationId, { status, outputs, costUsd });

    if (generationId) untrackPendingGeneration(generationId);
}

export function registerWebSocketHandlers() {
    websocketClient.on('generationUpdate', handleGenerationUpdate);
}
