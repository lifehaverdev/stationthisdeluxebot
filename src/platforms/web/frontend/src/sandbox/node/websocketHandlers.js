import { websocketClient } from '../ws.js';
import { setToolWindowOutput, addWindowCost, trackPendingGeneration, untrackPendingGeneration, updatePendingGeneration } from '../state.js';

// ResultContent is now handled by microact ResultDisplay component.
// The WS handler writes output to state; components poll and render.
// This stub prevents import errors from legacy code paths.
function renderResultContent() {}

// A map to associate generation IDs with their corresponding tool window elements
export const generationIdToWindowMap = {};
// Map castId (unique per spell run) to window to improve lookup reliability
export const castIdToWindowMap = {};

// GPU cost rates (USD per second) - should match backend
const GPU_COST_PER_SECOND = {
    'T4': 0.00018,
    'L4': 0.00032,
    'A10G': 0.000337,
    'L40S': 0.000596,
    'A100': 0.00114,
    'A100-80GB': 0.001708,
    'H100': 0.002338,
    'H200': 0.001891,
    'B200': 0.002604,
    'CPU': 0.000042
};

// Fallback exchange rates (used only if CostHUD rates are unavailable)
const USD_TO_POINTS_CONVERSION_RATE = 0.000337; // 1 USD = 0.000337 points (1 point = ~$2,967 USD)
const FALLBACK_RATES = {
    POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE, // ~2,967 points per USD
    MS2_per_USD: 2,
    CULT_per_USD: 50
};

/**
 * Get current exchange rates from CostHUD or fallback to defaults
 * @returns {Object} Exchange rates object
 */
function getCurrentExchangeRates() {
    // Try to get rates from CostHUD first (real-time rates)
    if (typeof window !== 'undefined' && window.costHUD && window.costHUD.exchangeRates) {
        debugLog('COST_EXCHANGE_RATES', '[Cost] Using real-time exchange rates from CostHUD:', window.costHUD.exchangeRates);
        return window.costHUD.exchangeRates;
    }
    
    // Fallback to hardcoded rates if CostHUD not available
    debugLog('COST_TRACKING', '[Cost] CostHUD rates not available, using fallback rates');
    return FALLBACK_RATES;
}

/**
 * Calculate and track cost for a completed execution
 * @param {HTMLElement} toolWindowEl - Tool window element
 * @param {Object} payload - WebSocket payload with execution details
 */
function calculateAndTrackCost(toolWindowEl, payload) {
    const { durationMs, gpuType, costUsd } = payload;
    const windowId = toolWindowEl.id;
    
    if (!windowId) return;

    let usdCost = 0;
    
    // Use provided cost from server (this is the accurate cost from the database)
    if (costUsd !== undefined && costUsd !== null) {
        usdCost = costUsd;
        debugLog('COST_TRACKING', `[Cost] Using server-provided cost: $${usdCost} for ${windowId}`);
    } else if (durationMs && gpuType) {
        // Fallback: calculate from duration and GPU type (for legacy compatibility)
        const gpuCostPerSecond = GPU_COST_PER_SECOND[gpuType] || GPU_COST_PER_SECOND['CPU'];
        usdCost = gpuCostPerSecond * (durationMs / 1000);
        debugLog('COST_TRACKING', `[Cost] Calculated cost from duration/GPU: $${usdCost} for ${windowId}`);
    } else {
        debugLog('COST_TRACKING', '[Cost] Missing cost data for execution', { durationMs, gpuType, costUsd });
        return;
    }

    // Get current exchange rates (real-time from CostHUD or fallback)
    const exchangeRates = getCurrentExchangeRates();
    
    // Convert to all currencies using current exchange rates
    const costData = {
        usd: usdCost,
        points: usdCost * exchangeRates.POINTS_per_USD,
        ms2: usdCost * exchangeRates.MS2_per_USD,
        cult: usdCost * exchangeRates.CULT_per_USD
    };

    // Add cost to window
    addWindowCost(windowId, costData);
    
    debugLog('COST_TRACKING', `[Cost] Tracked cost for ${windowId}:`, costData);
    console.log(`[WebSocket] Cost tracked for ${windowId}:`, costData);
}
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
import { debugLog } from '../config/debugConfig.js';

function handleGenerationProgress(payload) {
    debugLog('WEBSOCKET_PROGRESS', '[Sandbox] Generation progress received:', payload);
    debugLog('WEBSOCKET_DEBUG_PROGRESS', '[DEBUG progress] map keys', Object.keys(castIdToWindowMap));
    const { generationId, progress, status, liveStatus, toolId, spellId, castId = null, cookId = null } = payload;

    // Ignore cook-driven tool runs (cookId present but no castId) – they belong to backend only
    if (cookId && !castId) {
        return; // do not route into sandbox windows
    }

    let toolWindow = generationIdToWindowMap[generationId] || (castId && castIdToWindowMap[castId]);
    if(!toolWindow && castId){
        console.log('[DEBUG progress] lookup failed for castId', castId, 'map has', castIdToWindowMap[castId]);
    }

    // Restricted toolId fallback – only consider ACTIVE windows (have progress indicator)
    if (castId && !toolWindow && toolId) { // only attempt if castId known
        document.querySelectorAll('.spell-window').forEach(sw=>{
            if(toolWindow) return;
            if(!sw.querySelector('.progress-indicator')) return;
            if(sw.dataset.castId && sw.dataset.castId !== String(castId)) return;
            const li=sw.querySelector(`.spell-step-status li[data-tool-id="${toolId}"]`) || [...sw.querySelectorAll('.spell-step-status li')].find(li=>li.textContent.includes(toolId));
            if(li){ toolWindow=sw; generationIdToWindowMap[generationId]=sw; }
        });
    }

    if (!toolWindow){
        console.warn('[Sandbox] Progress: could not map to window', {generationId, spellId, toolId});
    }

    if (toolWindow) {
        let progressIndicator = toolWindow.querySelector('.progress-indicator');
        if (!progressIndicator) {
            progressIndicator = document.createElement('div');
            progressIndicator.className = 'progress-indicator';
            toolWindow.appendChild(progressIndicator);
        }
        // Attach IDs for easier debugging and potential UI use
        progressIndicator.dataset.generationId = generationId;
        if (castId) progressIndicator.dataset.castId = castId;
        if (cookId) progressIndicator.dataset.cookId = cookId;
        const progressPercent = progress ? `(${(progress * 100).toFixed(1)}%)` : '';
        progressIndicator.textContent = `Status: ${liveStatus || status} ${progressPercent}`;

        // --- NEW: update spell progress bar continuously ---
        const bar = toolWindow.querySelector('.spell-progress-bar');
        if(bar){
            const total = stepList(toolWindow).length || 1;
            const done  = toolWindow.querySelectorAll('.spell-step-status li.done').length;
            const frac  = (done + (progress || 0)) / total;
            bar.value = Math.round(frac * 100);
        }
        // Cache by castId for subsequent steps
        if (castId) {
            toolWindow.dataset.castId = castId;
            castIdToWindowMap[castId] = toolWindow;
        }

        // Track pending generation for persistence
        if (generationId && toolWindow.id) {
            trackPendingGeneration(generationId, toolWindow.id, {
                castId,
                toolId,
                spellId,
                cookId,
                status: status || 'pending',
                lastProgress: progress || 0
            });
        }
    }
}

/**
 * Handles the final result update from the WebSocket.
 * @param {object} payload - The final result payload from the server.
 */
export function handleGenerationUpdate(payload) {
    const { generationId, outputs, status, toolId, spellId, castId, cookId, error, message } = payload;

    // Ignore cook-driven tool updates that have cookId but no castId
    if (cookId && !castId) {
        return;
    }

    let toolWindowEl = generationIdToWindowMap[generationId] || (castId && castIdToWindowMap[castId]);

    // spellId fallback removed

    if(castId && !toolWindowEl && toolId){
        document.querySelectorAll('.spell-window').forEach(sw=>{
            if(toolWindowEl) return;
            if(!sw.querySelector('.progress-indicator')) return;
            if(sw.dataset.castId && (sw.dataset.castId.startsWith('pending-') || sw.dataset.castId !== String(castId))) return;
            if([...sw.querySelectorAll('.spell-step-status li')].some(li=>li.textContent.includes(toolId))){
               toolWindowEl=sw;
               generationIdToWindowMap[generationId]=sw;
            }
        });
    }

    // Debug
    debugLog('WEBSOCKET_UPDATE', '[WS] generationUpdate received', { generationId, toolId, status });
    console.log('[WS] Looking for window with generationId:', generationId, 'Found:', toolWindowEl ? toolWindowEl.id : 'NOT FOUND');
    console.log('[WS] generationIdToWindowMap keys:', Object.keys(generationIdToWindowMap));

    if (toolWindowEl) {
        // also add to window for debugging
        if (castId) {
            toolWindowEl.dataset.castId = castId;
            castIdToWindowMap[castId] = toolWindowEl;
        }
        const progressIndicator = toolWindowEl.querySelector('.progress-indicator');
        if (progressIndicator) progressIndicator.remove();

        // Re-use any existing result container (legacy or new) to avoid duplicates
        let resultContainer = toolWindowEl.querySelector('.result-container');

        // Decide where to place a new container if none exists
        const containerParent = resultContainer
              ? resultContainer.parentElement
              : (toolWindowEl.querySelector('.window-body') || toolWindowEl);

        if (!resultContainer) {
            resultContainer = document.createElement('div');
            resultContainer.className = 'result-container';
            containerParent.appendChild(resultContainer);
        }
        // ensure it's visible and clear any previous content
        resultContainer.style.display = 'block';
        resultContainer.style.visibility = 'visible';
        console.log('[WS] Using result container:', resultContainer, 'parent:', containerParent);

        if (status === 'completed' || status === 'success') {
            // Cost tracking is handled on the client side via WebSocket events
            // The server just needs to include cost data in the payload

            let outputData;

            // --- 1. Spell multi-step payload ---
            console.log('[WS decode] analysing outputs', outputs);
            if (outputs.steps && Array.isArray(outputs.steps)) {
                outputData = { type: 'spell', steps: outputs.steps, ...(outputs.final ? { final: outputs.final } : {}), generationId };
            }

            // --- 2. Single-image array payload from ComfyDeploy ---
            else if (Array.isArray(outputs) && outputs[0]?.data?.images?.[0]?.url) {
                outputData = { type: 'image', url: outputs[0].data.images[0].url, generationId };
            }

            // --- 2b. Images array inside object (non-array payload) ---
            else if (Array.isArray(outputs.images)) {
                const first = outputs.images[0];
                const url = typeof first==='string'? first : (first?.url || first);
                console.log('[WS] Parsing images array, first:', first, 'url:', url);
                if(url) outputData = { type: 'image', url, generationId };
            }

            // --- 3. Flat imageUrl field ---
            else if (outputs.imageUrl) {
                outputData = { type: 'image', url: outputs.imageUrl, generationId };
            }

            // --- 3b. Flat 'image' field ---
            else if (outputs.image) {
                outputData = { type: 'image', url: outputs.image, generationId };
            }

            // --- 3c. artifactUrls array ---
            else if (Array.isArray(outputs.artifactUrls) && outputs.artifactUrls.length) {
                outputData = { type: 'image', url: outputs.artifactUrls[0], generationId };
            }

            // --- 2c. Typed video entry from async adapter: [{ type: 'video', data: { videoUrl } }] ---
            else if (Array.isArray(outputs) && outputs[0]?.type === 'video' && outputs[0]?.data?.videoUrl) {
                outputData = { type: 'video', url: outputs[0].data.videoUrl, generationId };
            }

            // --- 2d. Files array with video (.mp4, .webm) or mixed content ---
            else if (Array.isArray(outputs) && outputs[0]?.data?.files?.[0]?.url) {
                const files = outputs[0].data.files;
                const file = files[0];
                if(/\.mp4$|\.webm$/i.test(file.url)){
                    outputData = { type: 'video', url: file.url, generationId };
                } else {
                    outputData = { type: 'file', files, generationId };
                }
            }

            // --- 2e. Files array at top level (from toWebFormat) ---
            else if (Array.isArray(outputs.files) && outputs.files.length) {
                const files = outputs.files;
                const vidFile = files.find(f => /\.mp4$|\.webm$/i.test(f.url || ''));
                if (vidFile && files.length === 1) {
                    outputData = { type: 'video', url: vidFile.url, generationId };
                } else {
                    outputData = { type: 'file', files, generationId };
                }
            }
            // --- 3d. Flat videoUrl field ---
            else if (outputs.videoUrl || outputs.video) {
                outputData = { type: 'video', url: outputs.videoUrl || outputs.video, generationId };
            }

            // --- 4. Text variants ---
            else if (outputs.text) {
                outputData = { type: 'text', text: outputs.text, generationId };
            } else if (outputs.response) {
                outputData = { type: 'text', text: outputs.response, generationId };
            } else if (outputs.result) {
                // Handle { result: "text" } format (should be normalized by backend, but fallback for safety)
                outputData = { type: 'text', text: outputs.result, generationId };
            } else if (Array.isArray(outputs) && outputs[0]?.data?.text) {
                const t = outputs[0].data.text;
                outputData = { type: 'text', text: Array.isArray(t) ? t.join('\n\n') : t, generationId };
            }
            else if (Array.isArray(outputs) && typeof outputs[0] === 'string') {
                outputData = { type: 'text', text: outputs.join('\n\n'), generationId };
            } else if (typeof outputs === 'string') {
                outputData = { type: 'text', text: outputs, generationId };
            }
            else if (outputs.description) {
                outputData = { type: 'text', text: outputs.description, generationId };
            }

            // --- 5. Fallback ---
            else {
                outputData = { type: 'unknown', generationId, ...outputs };
            }
            
            setToolWindowOutput(toolWindowEl.id, outputData);
            
            // Calculate and track cost on client side
            calculateAndTrackCost(toolWindowEl, payload);
            
            // mark step done and update step cost
            let li=toolWindowEl.querySelector(`.spell-step-status li[data-tool-id="${toolId}"]`);
            if(!li){ li=[...stepList(toolWindowEl)].find(li=>li.textContent.includes(toolId)); }
            if(!li){
                // Fallback: mark first pending step as done
                li=[...stepList(toolWindowEl)].find(li=>li.classList.contains('pending'));
            }
            if(li) {
                li.className='done';
                
                // Update step cost display
                const costSpan = li.querySelector('.step-cost');
                if (costSpan) {
                    const { durationMs, gpuType, costUsd } = payload;
                    let usdCost = 0;
                    
                    // Use provided cost from server (same logic as calculateAndTrackCost)
                    if (costUsd !== undefined && costUsd !== null) {
                        usdCost = costUsd;
                    } else if (durationMs && gpuType) {
                        const gpuCostPerSecond = GPU_COST_PER_SECOND[gpuType] || GPU_COST_PER_SECOND['CPU'];
                        usdCost = gpuCostPerSecond * (durationMs / 1000);
                    }
                    
                    if (usdCost > 0) {
                        // Convert to points for display
                        const exchangeRates = getCurrentExchangeRates();
                        const points = Math.round(usdCost * exchangeRates.POINTS_per_USD);
                        costSpan.textContent = ` - ${points} POINTS`;
                        costSpan.style.color = '#4CAF50'; // Green for completed
                    } else {
                        costSpan.textContent = ' - Free';
                        costSpan.style.color = '#4CAF50';
                    }
                }
            }
            // NEW: update spell progress bar after marking step done
            const bar=toolWindowEl.querySelector('.spell-progress-bar');
            if(bar){
                const total=stepList(toolWindowEl).length;
                const done=toolWindowEl.querySelectorAll('.spell-step-status li.done').length;
                bar.value=Math.round((done/total)*100);
            }
            debugLog('WEBSOCKET_RENDER', '[WS] Rendering output', outputData);
            console.log('[WS] About to render outputData:', outputData, 'to container:', resultContainer);
            renderResultContent(resultContainer, outputData);
            console.log('[WS] After render, container innerHTML length:', resultContainer.innerHTML.length);
            
            // If this is a CollectionWindow, display trait/param info
            if (toolWindowEl.classList.contains('collection-window') && toolWindowEl._collectionWindowInstance) {
                try {
                    if (typeof toolWindowEl._collectionWindowInstance._renderTraitAndParamInfo === 'function') {
                        toolWindowEl._collectionWindowInstance._renderTraitAndParamInfo(resultContainer);
                    }
                } catch (e) {
                    console.warn('[WS] Could not render trait/param info:', e);
                }
            }
            
        } else {
            // Handle failure status - show user-friendly error message
            // Check multiple possible locations for error message
            const errorMessage = error || message || 
                               outputs?.error || outputs?.message || outputs?.description || 
                               (Array.isArray(outputs) && outputs[0]?.error) ||
                               (Array.isArray(outputs) && outputs[0]?.message) ||
                               (typeof outputs === 'string' ? outputs : 
                                (outputs && typeof outputs === 'object' && !Array.isArray(outputs) ? JSON.stringify(outputs) : 
                                 'Generation failed. Please check your inputs and try again.'));
            
            // Escape HTML for safety
            const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
            const safeMessage = escapeHtml(errorMessage);
            
            resultContainer.innerHTML = `<div style="color: #ff6b6b; padding: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 8px; border: 1px solid rgba(255, 107, 107, 0.3); margin: 8px 0;">
                <strong>Generation Failed</strong><br>
                ${safeMessage}
            </div>`;
            
            // Also remove progress indicator if still present
            const progIndicator = toolWindowEl.querySelector('.progress-indicator');
            if (progIndicator) progIndicator.remove();
            
            // Remove progress bar if present
            const progBar = toolWindowEl.querySelector('.spell-progress-bar');
            if (progBar) progBar.remove();
        }

        // Cleanup legacy DOM window mapping (only if we found a window)
        const isSpellWindow = !!spellId || toolWindowEl.classList.contains('spell-window');
        if (isSpellWindow) {
            const stepsTotal = stepList(toolWindowEl).length;
            const stepsDone  = toolWindowEl.querySelectorAll('.spell-step-status li.done').length;
            const allStepsFinished = stepsTotal > 0 && stepsDone === stepsTotal;
            if (allStepsFinished) {
                delete generationIdToWindowMap[generationId];
            }
        } else {
            delete generationIdToWindowMap[generationId];
        }
    }

    // Resolve completion promise UNCONDITIONALLY — this unblocks SandboxCanvas._awaitCompletion()
    // regardless of whether a legacy DOM window was registered for this generationId.
    generationCompletionManager.resolveCompletionPromise(generationId, { status, outputs });

    // Untrack from pending generations (recovery tracking)
    if (generationId) {
        untrackPendingGeneration(generationId);
    }
}

// Register WebSocket event listeners
export function registerWebSocketHandlers() {
    websocketClient.on('generationProgress', handleGenerationProgress);
    websocketClient.on('generationUpdate', handleGenerationUpdate);
    websocketClient.on('tool-response', handleToolResponse);
}

// ---- TOOL RESPONSE (immediate path) --------------------
function stepList(win){return win.querySelectorAll('.spell-step-status li');}

function findSpellWindowByToolId(toolId){
  let win=null;
  document.querySelectorAll('.spell-window').forEach(sw=>{
      if(win) return;
      if(!sw.querySelector('.progress-indicator')) return; // only active windows
      if(window._wsCurrentCastId && sw.dataset.castId && sw.dataset.castId !== String(window._wsCurrentCastId)) return;
      if(sw.querySelector(`.spell-step-status li[data-tool-id="${toolId}"]`) || [...sw.querySelectorAll('.spell-step-status li')].some(li=>li.textContent.includes(toolId))){
         win=sw;
      }
  });
  return win;
}

function handleToolResponse({ toolId, output, requestId }){
    let win=findSpellWindowByToolId(toolId);
    if(!win){
        // legacy fallback textIncludes
        document.querySelectorAll('.spell-window').forEach(sw=>{
            if(win) return;
            if([...stepList(sw)].some(li=>li.textContent.includes(toolId))) win=sw;
        });
    }
    if(!win) return;

    const li=win.querySelector(`.spell-step-status li[data-tool-id="${toolId}"]`) || [...stepList(win)].find(li=>li.textContent.includes(toolId));
    if(li) {
        li.className='done';
        
        // Update step cost display for immediate response
        const costSpan = li.querySelector('.step-cost');
        if (costSpan) {
            // For immediate responses, we don't have cost data, so show as completed
            costSpan.textContent = ' - Completed';
            costSpan.style.color = '#4CAF50';
        }
    }

    // progress bar update
    const bar=win.querySelector('.spell-progress-bar');
    if(bar){
        const total=stepList(win).length;
        const done=win.querySelectorAll('.spell-step-status li.done').length;
        bar.value=Math.round((done/total)*100);
    }

    // --- NEW: clear progress indicator once this step completes ---
    const prog=win.querySelector('.progress-indicator');
    if(prog){
        // If there are still pending steps, update status text instead of removing
        const total=stepList(win).length;
        const done=win.querySelectorAll('.spell-step-status li.done').length;
        if(done===total){
            prog.remove();
        }else{
            prog.textContent=`In progress: ${done}/${total} steps complete`;
        }
    }

    // render output
    let rc=win.querySelector('.result-container');
    if(!rc){
        const body=win.querySelector('.window-body')||win;
        rc=document.createElement('div');
        rc.className='result-container';
        body.appendChild(rc);
    }
    Promise.resolve({ renderResultContent }).then(m=>{
        const data=typeof output==='string'?{type:'text',text:output}:{...output};
        m.renderResultContent(rc,data);
    });
} 