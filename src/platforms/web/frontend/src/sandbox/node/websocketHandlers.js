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

// --- Cast Completion Tracker ---
// Used by SandboxCanvas._awaitSpellCompletion() to resolve spell (multi-step) execution promises.
// Spells fire one generationUpdate per step, each carrying the shared castId. We resolve only
// after all steps have reported completed/failed — or immediately on any failure.
const castCompletionTracker = {
    pending: new Map(), // castId → { resolver, totalSteps, completed, latestPayload, onStep }

    register(castId, totalSteps, onStep) {
        let resolver;
        const promise = new Promise(resolve => { resolver = resolve; });
        this.pending.set(castId, { resolver, totalSteps, completed: 0, latestPayload: null, onStep });
        return promise;
    },

    notifyStep(castId, payload) {
        const entry = this.pending.get(castId);
        if (!entry) return;
        const terminal = payload.status === 'completed' || payload.status === 'failed';
        if (terminal) {
            entry.completed++;
            entry.latestPayload = payload;
            entry.onStep?.({ completed: entry.completed, total: entry.totalSteps, payload });
        }
        if (entry.completed >= entry.totalSteps || payload.status === 'failed') {
            entry.resolver(entry.latestPayload);
            this.pending.delete(castId);
        }
    },

    cancel(castId) {
        this.pending.delete(castId);
    },
};
export { castCompletionTracker };

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

    // Notify spell cast tracker — spell steps carry castId alongside their own generationId
    if (castId) castCompletionTracker.notifyStep(castId, { status, outputs, costUsd });

    if (generationId) untrackPendingGeneration(generationId);
}

export function registerWebSocketHandlers() {
    websocketClient.on('generationUpdate', handleGenerationUpdate);
}
