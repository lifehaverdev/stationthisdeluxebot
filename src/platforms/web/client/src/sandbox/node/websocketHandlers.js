import { websocketClient } from '/js/websocketClient.js';
import { setToolWindowOutput } from '../state.js';
import { renderResultContent } from './resultContent.js';

// A map to associate generation IDs with their corresponding tool window elements
export const generationIdToWindowMap = {};

// --- NEW: Generation Completion Manager ---
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
// -----------------------------------------

/**
 * Handles real-time progress updates from the WebSocket.
 * @param {object} payload - The progress payload from the server.
 */
function handleGenerationProgress(payload) {
    console.log('[Sandbox] Generation progress received:', payload);
    const { generationId, progress, status, liveStatus } = payload;
    const toolWindow = generationIdToWindowMap[generationId];

    if (toolWindow) {
        let progressIndicator = toolWindow.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            toolWindow.appendChild(progressIndicator);
        }
        const progressPercent = progress ? `(${(progress * 100).toFixed(1)}%)` : '';
        progressIndicator.textContent = `Status: ${liveStatus || status} ${progressPercent}`;
    }
}

/**
 * Handles the final result update from the WebSocket.
 * @param {object} payload - The final result payload from the server.
 */
export function handleGenerationUpdate(payload) {
    const { generationId, outputs, status } = payload;
    const toolWindowEl = generationIdToWindowMap[generationId];

    if (toolWindowEl) {
        const progressIndicator = toolWindowEl.querySelector('.progress-indicator');
        if (progressIndicator) progressIndicator.remove();

        let resultContainer = toolWindowEl.querySelector('.result-container');
        if (!resultContainer) {
            resultContainer = document.createElement('div');
            resultContainer.className = 'result-container';
            toolWindowEl.appendChild(resultContainer);
        }

        if (status === 'completed' || status === 'success') {
            let outputData;
            if (Array.isArray(outputs) && outputs[0]?.data?.images?.[0]?.url) {
                outputData = { type: 'image', url: outputs[0].data.images[0].url };
            } else if (outputs.imageUrl) {
                outputData = { type: 'image', url: outputs.imageUrl };
            } else if (outputs.text) {
                outputData = { type: 'text', text: outputs.text };
            } else {
                outputData = { type: 'unknown', ...outputs };
            }
            
            setToolWindowOutput(toolWindowEl.id, outputData);
            renderResultContent(resultContainer, outputData);
            
        } else {
            resultContainer.innerHTML = `<p style="color: red;">Failed: ${JSON.stringify(outputs, null, 2)}</p>`;
        }
        
        // --- NEW: Resolve the completion promise ---
        generationCompletionManager.resolveCompletionPromise(generationId, { status, outputs });
        // ------------------------------------------

        delete generationIdToWindowMap[generationId];
    }
}

// Register WebSocket event listeners
export function registerWebSocketHandlers() {
    websocketClient.on('generationProgress', handleGenerationProgress);
    websocketClient.on('generationUpdate', handleGenerationUpdate);
} 