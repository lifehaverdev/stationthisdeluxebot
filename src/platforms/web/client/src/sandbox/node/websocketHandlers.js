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
    const { generationId, progress, status, liveStatus, toolId, spellId, castId = null, cookId = null } = payload;

    let toolWindow = generationIdToWindowMap[generationId];

    if (!toolWindow && spellId) {
        toolWindow = document.querySelector(`.spell-window[data-spell-id="${spellId}"]`);
        if (toolWindow) generationIdToWindowMap[generationId] = toolWindow;        
    }

    if (!toolWindow && toolId) {
        // Fallback: find spell window containing this toolId in its step list
        document.querySelectorAll('.spell-window').forEach(sw=>{
            if(toolWindow) return;
            const li=[...sw.querySelectorAll('.spell-step-status li')].find(li=>li.textContent.includes(toolId));
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
    }
}

/**
 * Handles the final result update from the WebSocket.
 * @param {object} payload - The final result payload from the server.
 */
export function handleGenerationUpdate(payload) {
    const { generationId, outputs, status, toolId, spellId, castId, cookId } = payload;
    let toolWindowEl = generationIdToWindowMap[generationId];

    if (!toolWindowEl && spellId){
        toolWindowEl=document.querySelector(`.spell-window[data-spell-id="${spellId}"]`);
        if(toolWindowEl) generationIdToWindowMap[generationId]=toolWindowEl;
    }
    if(!toolWindowEl && toolId){
        document.querySelectorAll('.spell-window').forEach(sw=>{
            if(toolWindowEl) return;
            if([...sw.querySelectorAll('.spell-step-status li')].some(li=>li.textContent.includes(toolId))){
               toolWindowEl=sw;
               generationIdToWindowMap[generationId]=sw;
            }
        });
    }

    // Debug
    console.log('[WS] generationUpdate received', { generationId, toolId });

    if (toolWindowEl) {
        // also add to window for debugging
        toolWindowEl.dataset.castId = castId;
        toolWindowEl.dataset.cookId = cookId;
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
        // ensure it's visible
        resultContainer.style.display = 'block';

        if (status === 'completed' || status === 'success') {
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

            // --- 3. Flat imageUrl field ---
            else if (outputs.imageUrl) {
                outputData = { type: 'image', url: outputs.imageUrl, generationId };
            }

            // --- 4. Text variants ---
            else if (outputs.text) {
                outputData = { type: 'text', text: outputs.text, generationId };
            } else if (outputs.response) {
                outputData = { type: 'text', text: outputs.response, generationId };
            }

            // --- 5. Fallback ---
            else {
                outputData = { type: 'unknown', generationId, ...outputs };
            }
            
            setToolWindowOutput(toolWindowEl.id, outputData);
            // mark step done
            const li=[...stepList(toolWindowEl)].find(li=>li.textContent.includes(toolId));
            if(li) li.className='done';
            // NEW: update spell progress bar after marking step done
            const bar=toolWindowEl.querySelector('.spell-progress-bar');
            if(bar){
                const total=stepList(toolWindowEl).length;
                const done=toolWindowEl.querySelectorAll('.spell-step-status li.done').length;
                bar.value=Math.round((done/total)*100);
            }
            console.log('[WS] Rendering output', outputData);
            renderResultContent(resultContainer, outputData);
            
        } else {
            resultContainer.innerHTML = `<p style="color: red;">Failed: ${JSON.stringify(outputs, null, 2)}</p>`;
        }
        
        // --- NEW: Resolve the completion promise ---
        generationCompletionManager.resolveCompletionPromise(generationId, { status, outputs });
        // ------------------------------------------

        // For plain tool nodes we can remove the mapping now.  For spells we keep it
        // so subsequent step updates (new generationIds) can still fall back to the
        // same window via spellId searches.
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
      if(sw.querySelector(`.spell-step-status li[data-tool-id="${toolId}"]`)) win=sw;
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
    if(li) li.className='done';

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
    import('./resultContent.js').then(m=>{
        const data=typeof output==='string'?{type:'text',text:output}:{...output};
        m.renderResultContent(rc,data);
    });
} 