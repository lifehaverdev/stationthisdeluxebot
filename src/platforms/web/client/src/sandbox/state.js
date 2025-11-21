// Debug helper function gated by window.DEBUG_COST_LOGS
function stateDebug(...args) {
    if (typeof window !== 'undefined' && window.DEBUG_COST_LOGS) {
        console.log('[State]', ...args);
    }
}

// Global state
export let availableTools = [];
export let activeToolWindows = [];
export let lastClickPosition = null;
export let activeConnection = null;
export let connectionLine = null;
export let activeModal = false;
export let activeSubmenu = false;

// --- Selection Management ---
export const selectedNodeIds = new Set();
const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
let selectionChangeEvent = null;

function getSelectionChangeEvent() {
    if (!canUseDOM) return null;
    if (selectionChangeEvent) return selectionChangeEvent;
    if (typeof window.CustomEvent === 'function') {
        selectionChangeEvent = new window.CustomEvent('selectionchange');
    } else if (document?.createEvent) {
        selectionChangeEvent = document.createEvent('CustomEvent');
        selectionChangeEvent.initCustomEvent('selectionchange', false, false, null);
    }
    return selectionChangeEvent;
}

function dispatchSelectionChangeEvent() {
    const event = getSelectionChangeEvent();
    if (event && canUseDOM) {
        document.dispatchEvent(event);
    }
}

export const lasso = {
    active: false,
    x1: 0, y1: 0,
    x2: 0, y2: 0,
    element: null
};

// --- Persistent Node Connection System Scaffold ---

/**
 * Connection object for persistent node connections
 * @typedef {Object} Connection
 * @property {string} id - Unique connection id
 * @property {string} fromDisplayName - Display name of the source tool
 * @property {string} fromWindowId - Window id of the source node (runtime lookup)
 * @property {string} fromOutput - Output name/key (e.g. 'output_image')
 * @property {string} toDisplayName - Display name of the target tool
 * @property {string} toWindowId - Window id of the target node (runtime lookup)
 * @property {string} toInput - Input name/key (e.g. 'input_image')
 * @property {string} type - Data type (e.g. 'image', 'text')
 * @property {number} createdAt - Timestamp
 */

/** @type {Connection[]} */
export let connections = [];

export function getConnections() {
    return connections;
}

const CONNECTIONS_KEY = 'sandbox_connections';
const TOOL_WINDOWS_KEY = 'sandbox_tool_windows';
const PENDING_GENERATIONS_KEY = 'sandbox_pending_generations';
// --- New: persistence helpers ---
const SIZE_LIMIT = 100 * 1024; // 100 KB – max per output blob before truncation

function sanitizeOutput(output) {
    // Keep URLs but strip large base64 data URIs to avoid quota issues
    if (typeof output === 'string' && output.startsWith('data:') && output.length > SIZE_LIMIT) {
        return {
            truncated: true,
            mime: output.substring(5, output.indexOf(';')), // best-effort mime extraction
            size: output.length
        };
    }
    return output;
}

function downloadStateAsFile(connections, windows) {
    try {
        const payload = { connections, windows };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sandbox-workspace-${Date.now()}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        console.error('[State] Failed to download workspace JSON', e);
    }
}

// --- Pending Generation Tracking ---

/**
 * Track a pending generation for persistence across page reloads
 * @param {string} generationId - The generation ID from the backend
 * @param {string} windowId - The tool window ID
 * @param {Object} metadata - Additional metadata (castId, toolId, spellId, etc.)
 */
export function trackPendingGeneration(generationId, windowId, metadata = {}) {
    const pendingGenerations = getPendingGenerations();
    pendingGenerations[generationId] = {
        windowId,
        castId: metadata.castId || null,
        toolId: metadata.toolId || null,
        spellId: metadata.spellId || null,
        cookId: metadata.cookId || null,
        status: metadata.status || 'pending',
        requestTimestamp: metadata.requestTimestamp || new Date().toISOString(),
        lastProgress: metadata.lastProgress || 0
    };
    persistPendingGenerations(pendingGenerations);
    stateDebug('[PendingGen] Tracked generation:', generationId, 'for window:', windowId);
}

/**
 * Remove a generation from pending tracking (when completed or failed)
 * @param {string} generationId - The generation ID to remove
 */
export function untrackPendingGeneration(generationId) {
    const pendingGenerations = getPendingGenerations();
    if (pendingGenerations[generationId]) {
        delete pendingGenerations[generationId];
        persistPendingGenerations(pendingGenerations);
        stateDebug('[PendingGen] Untracked generation:', generationId);
    }
}

/**
 * Update pending generation status/progress
 * @param {string} generationId - The generation ID
 * @param {Object} updates - Status updates (status, lastProgress, etc.)
 */
export function updatePendingGeneration(generationId, updates) {
    const pendingGenerations = getPendingGenerations();
    if (pendingGenerations[generationId]) {
        Object.assign(pendingGenerations[generationId], updates);
        persistPendingGenerations(pendingGenerations);
        stateDebug('[PendingGen] Updated generation:', generationId, updates);
    }
}

/**
 * Get all pending generations
 * @returns {Object} Map of generationId -> generation data
 */
export function getPendingGenerations() {
    try {
        const raw = localStorage.getItem(PENDING_GENERATIONS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.error('[PendingGen] Failed to load pending generations:', e);
        return {};
    }
}

/**
 * Persist pending generations to localStorage
 * @param {Object} pendingGenerations - The pending generations object
 */
function persistPendingGenerations(pendingGenerations) {
    try {
        localStorage.setItem(PENDING_GENERATIONS_KEY, JSON.stringify(pendingGenerations));
    } catch (e) {
        console.error('[PendingGen] Failed to persist pending generations:', e);
    }
}

/**
 * Clear all pending generations (useful for cleanup)
 */
export function clearPendingGenerations() {
    try {
        localStorage.removeItem(PENDING_GENERATIONS_KEY);
        stateDebug('[PendingGen] Cleared all pending generations');
    } catch (e) {
        console.error('[PendingGen] Failed to clear pending generations:', e);
    }
}

// Serialize and save state to localStorage
export function persistState() {
    // Only store serializable data
    const serializableConnections = connections.map(({ element, ...rest }) => rest);
    const serializableWindows = activeToolWindows.map(w => {
        const base = {
            id: w.id,
            workspaceX: w.workspaceX,
            workspaceY: w.workspaceY,
            output: sanitizeOutput(w.output || null),
            outputVersions: (w.outputVersions || []).map(v => ({
                output: sanitizeOutput(v.output),
                params: v.params
            })),
            currentVersionIndex: w.currentVersionIndex ?? -1,
            parameterMappings: w.parameterMappings || {},
            costVersions: w.costVersions || [],
            totalCost: w.totalCost || { usd: 0, points: 0, ms2: 0, cult: 0 }
        };
        if (w.isSpell) {
            return {
                ...base,
                isSpell: true,
                spell: w.spell
            };
        }
        return {
            ...base,
            displayName: w.tool?.displayName || '',
            toolId: w.tool?.toolId || ''
        };
    });

    try {
        localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(serializableConnections));
        localStorage.setItem(TOOL_WINDOWS_KEY, JSON.stringify(serializableWindows));
        return true;
    } catch (e) {
        console.error('[State] Failed to persist state', e);
        // Notify UI via toast or fallback alert
        const message = `Failed to save workspace: ${e.message}`;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'error', message } }));
        } else {
            alert(message);
        }
        // If quota exceeded – offer JSON download fallback
        if (e && (e.name === 'QuotaExceededError' || e.message?.includes('quota'))) {
            downloadStateAsFile(serializableConnections, serializableWindows);
        }
        return false;
    }
}

// Load state from localStorage
function loadState() {
    const connRaw = localStorage.getItem(CONNECTIONS_KEY);
    const winRaw = localStorage.getItem(TOOL_WINDOWS_KEY);
    if (connRaw) {
        try {
            connections = JSON.parse(connRaw);
        } catch (e) { connections = []; }
    }
    if (winRaw) {
        try {
            const wins = JSON.parse(winRaw);

            // Deduplicate windows by ID, keeping the last one found
            const uniqueWinsMap = new Map();
            wins.forEach(w => uniqueWinsMap.set(w.id, w));
            const uniqueWins = Array.from(uniqueWinsMap.values());

            activeToolWindows = uniqueWins.map(w => {
                if (w.isSpell) {
                    return {
                        id: w.id,
                        spell: w.spell,
                        isSpell: true,
                        workspaceX: w.workspaceX,
                        workspaceY: w.workspaceY,
                        output: w.output || null,
                        outputVersions: w.outputVersions || [],
                        currentVersionIndex: w.currentVersionIndex ?? -1,
                        parameterMappings: w.parameterMappings || {},
                        costVersions: w.costVersions || [],
                        totalCost: w.totalCost || { usd: 0, points: 0, ms2: 0, cult: 0 }
                    };
                }
                return {
                    id: w.id,
                    tool: {
                        displayName: w.displayName,
                        toolId: w.toolId
                    },
                    workspaceX: w.workspaceX,
                    workspaceY: w.workspaceY,
                    output: w.output || null,
                    outputVersions: w.outputVersions || [],
                    currentVersionIndex: w.currentVersionIndex ?? -1,
                    parameterMappings: w.parameterMappings || {},
                    costVersions: w.costVersions || [],
                    totalCost: w.totalCost || { usd: 0, points: 0, ms2: 0, cult: 0 }
                };
            });
            stateDebug(`Loaded ${activeToolWindows.length} unique tool windows from storage.`);
        } catch (e) { activeToolWindows = []; }
    }
}

// --- Undo/Redo History Stack (REMOVED) ---
// The sandbox previously maintained a 50-entry undo/redo history. This logic has been
// removed to reduce memory usage and prevent snapshot bloat in localStorage. The
// exported functions remain as thin stubs so that existing calls don’t break.

export function pushHistory() {
    // With the history system removed, treat a history push as an immediate persist.
    persistState();
}

export function undo() {
    console.warn('[state.js] undo() called but history has been removed. No-op.');
}

export function redo() {
    console.warn('[state.js] redo() called but history has been removed. No-op.');
}

// Patch add/remove/clear to push history
export function addConnection(connection) {
    connections.push(connection);
}

export function removeConnection(connectionId) {
    connections = connections.filter(c => c.id !== connectionId);
}

export function clearConnectionsForWindow(windowId) {
    connections = connections.filter(c => c.fromWindowId !== windowId && c.toWindowId !== windowId);
}

// TODO: Add undo/redo stack for connections

// Type mappings
export const CREATION_TYPE_TO_CATEGORY = {
    'image': 'text-to-image',
    'sound': 'text-to-audio',
    'text': 'text-to-text',
    'movie': 'text-to-video'
};

export const OUTPUT_TYPE_EMOJI = {
    'image': '🖼️',
    'text': '📝',
    'audio': '🎵',
    'video': '🎬'
};

// Initialize state
export function initState() {
    availableTools = [];
    activeToolWindows = [];
    connections = [];
    lastClickPosition = null;
    activeConnection = null;
    connectionLine = null;
    activeModal = false;
    activeSubmenu = false;
    selectedNodeIds.clear();
    loadState();

    // History system removed – no baseline snapshot required.
}

// State getters and setters
export function setModalState(state) {
    activeModal = state;
}

export function getModalState() {
    return activeModal;
}

export function setSubmenuState(state) {
    activeSubmenu = state;
}

export function getSubmenuState() {
    return activeSubmenu;
}

// --- Selection Getters/Setters ---

export function getSelectedNodeIds() {
    return selectedNodeIds;
}

export function isNodeSelected(id) {
    return selectedNodeIds.has(id);
}

export function selectNode(id, additive = false) {
    if (!additive) {
        // Create a copy of the set before clearing, to know which nodes to update.
        const previouslySelected = new Set(selectedNodeIds);
        selectedNodeIds.clear();
        previouslySelected.forEach(nodeId => {
            if (nodeId !== id) {
                const el = document.getElementById(nodeId);
                if (el) el.classList.remove('node-selected');
            }
        });
    }
    selectedNodeIds.add(id);
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('node-selected');
        // Force repaint
        void el.offsetHeight;
        el.style.boxShadow = getComputedStyle(el).boxShadow;
        stateDebug('[SELECTNODE] Added node-selected to', id);
    } else {
        stateDebug('[SELECTNODE] Could not find element for ID', id);
    }
    stateDebug('[selectNode] selection now:', Array.from(selectedNodeIds));
    dispatchSelectionChangeEvent();
}

export function deselectNode(id) {
    selectedNodeIds.delete(id);
    const el = document.getElementById(id);
    if (el) el.classList.remove('node-selected');
    dispatchSelectionChangeEvent();
}

export function toggleNodeSelection(id) {
    if (isNodeSelected(id)) {
        deselectNode(id);
    } else {
        // Toggle is always additive
        selectNode(id, true);
    }
    // deselectNode and selectNode already dispatch the event
}

export function clearSelection() {
    const previouslySelected = new Set(selectedNodeIds);
    selectedNodeIds.clear();
    previouslySelected.forEach(nodeId => {
        const el = document.getElementById(nodeId);
        if (el) el.classList.remove('node-selected');
    });
    stateDebug('[clearSelection] selection now:', Array.from(selectedNodeIds));
    dispatchSelectionChangeEvent();
}

// --- End Selection ---


export function setLastClickPosition(position) {
    lastClickPosition = position;
}

export function getLastClickPosition() {
    return lastClickPosition;
}

export function setAvailableTools(tools) {
    stateDebug('Setting available tools:', tools);
    availableTools = tools;
}

export function getAvailableTools() {
    return availableTools;
}

export function getToolWindows() {
    return activeToolWindows;
}

export function getToolWindow(id) {
    return activeToolWindows.find(w => w.id === id);
}

export function updateToolWindowPosition(id, workspaceX, workspaceY) {
    const window = getToolWindow(id);
    if (window) {
        window.workspaceX = workspaceX;
        window.workspaceY = workspaceY;
    }
}

// Output type mapping
export const OUTPUT_TYPE_MAPPING = {
    'image': {
        emoji: '🖼️',
        modalTitle: 'Create Image',
        categories: [
            {
                name: 'Generate',
                filter: tool => {
                    stateDebug('Checking tool for image generation:', tool);
                    // Check various ways a tool might be identified as an image generator
                    return (
                        tool.displayName?.toLowerCase().includes('make') ||
                        tool.description?.toLowerCase().includes('generate') ||
                        tool.description?.toLowerCase().includes('text to image') ||
                        tool.category === 'text-to-image' ||
                        (tool.metadata?.outputType === 'image' && tool.metadata?.inputType === 'text')
                    );
                }
            },
            {
                name: 'Transform',
                filter: tool => {
                    stateDebug('Checking tool for image transformation:', tool);
                    // Check various ways a tool might be identified as an image transformer
                    return (
                        tool.displayName?.toLowerCase().includes('effect') ||
                        tool.description?.toLowerCase().includes('image to image') ||
                        tool.category === 'image-to-image' ||
                        (tool.metadata?.outputType === 'image' && tool.metadata?.inputType === 'image')
                    );
                }
            }
        ]
    },
    'sound': {
        emoji: '🎵',
        modalTitle: 'Create Audio',
        categories: [
            {
                name: 'Generate',
                filter: tool => {
                    stateDebug('Checking tool for audio generation:', tool);
                    return (
                        tool.description?.toLowerCase().includes('text to audio') ||
                        tool.category === 'text-to-audio' ||
                        (tool.metadata?.outputType === 'audio' && tool.metadata?.inputType === 'text')
                    );
                }
            },
            {
                name: 'Transform',
                filter: tool => {
                    stateDebug('Checking tool for audio transformation:', tool);
                    return (
                        tool.description?.toLowerCase().includes('audio to audio') ||
                        tool.category === 'audio-to-audio' ||
                        (tool.metadata?.outputType === 'audio' && tool.metadata?.inputType === 'audio')
                    );
                }
            }
        ]
    },
    'text': {
        emoji: '📝',
        modalTitle: 'Create Text',
        categories: [
            {
                name: 'Generate',
                filter: tool => {
                    stateDebug('Checking tool for text generation:', tool);
                    return (
                        tool.displayName === 'ChatGPT' ||
                        tool.description?.toLowerCase().includes('text to text') ||
                        tool.category === 'text-to-text' ||
                        (tool.metadata?.outputType === 'text' && tool.metadata?.inputType === 'text')
                    );
                }
            }
        ]
    },
    'movie': {
        emoji: '🎬',
        modalTitle: 'Create Video',
        categories: [
            {
                name: 'Generate',
                filter: tool => {
                    stateDebug('Checking tool for video generation:', tool);
                    return (
                        tool.displayName?.toLowerCase().includes('video') ||
                        tool.description?.toLowerCase().includes('text to video') ||
                        tool.category === 'text-to-video' ||
                        (tool.metadata?.outputType === 'video' && tool.metadata?.inputType === 'text')
                    );
                }
            },
            {
                name: 'Transform',
                filter: tool => {
                    stateDebug('Checking tool for video transformation:', tool);
                    return (
                        tool.description?.toLowerCase().includes('video to video') ||
                        tool.category === 'video-to-video' ||
                        (tool.metadata?.outputType === 'video' && tool.metadata?.inputType === 'video')
                    );
                }
            }
        ]
    }
};

// Window and connection management
export function addToolWindow(windowData) {
    const existingIndex = activeToolWindows.findIndex(w => w.id === windowData.id);
    let model;
    if (existingIndex > -1) {
        // Merge to preserve existing array/object references
        model = activeToolWindows[existingIndex];
        Object.assign(model, windowData);
    } else {
        model = windowData;
        activeToolWindows.push(model);
    }
    return model; // Return the canonical shared object
}

export function removeToolWindow(windowId) {
    activeToolWindows = activeToolWindows.filter(w => w.id !== windowId);
    const windowEl = document.getElementById(windowId);
    if (windowEl) {
        windowEl.remove();
    }
    // Persist immediately so closed windows don’t resurrect on reload.
    try {
        persistState();
    } catch {}
}

export function setActiveConnection(connection) {
    activeConnection = connection;
}

export function getActiveConnection() {
    return activeConnection;
}

export function setConnectionLine(line) {
    connectionLine = line;
}

export function setToolWindowOutput(id, output) {
    const win = getToolWindow(id);
    if (win) {
        // --- Versioning Support ---
        // Maintain an array of outputs (versions) instead of a single value.
        if (!Array.isArray(win.outputVersions)) {
            win.outputVersions = [];
        }
        const lastIdx = win.outputVersions.length - 1;
        // Handle windows that don't have parameterMappings (like CollectionWindow)
        const params = win.parameterMappings ? JSON.parse(JSON.stringify(win.parameterMappings)) : {};
        const versionObj = { output, params };

        if (lastIdx >= 0 && win.outputVersions[lastIdx] && win.outputVersions[lastIdx]._pending) {
            win.outputVersions[lastIdx] = versionObj;
            win.currentVersionIndex = lastIdx;
        } else {
            win.outputVersions.push(versionObj);
            win.currentVersionIndex = win.outputVersions.length - 1;
        }
        // Track latest single output for backward compatibility
        win.output = output;

        // Persist updated versions so they survive page reload
        try {
            persistState();
        } catch {}

        // Attempt to refresh version selector UI if running in browser
        if (typeof document !== 'undefined') {
            const el = document.getElementById(id);
            if (el && el.versionSelector && el.versionSelector.querySelector) {
                const btn = el.versionSelector.querySelector('.version-button');
                if (btn && typeof btn.refreshDropdown === 'function') {
                    btn.refreshDropdown();
                }
            }
        }
    }
}

// --- Cost Management Functions ---

/**
 * Add cost data for a window execution
 * @param {string} windowId - Window ID
 * @param {Object} costData - Cost data with usd, points, ms2, cult
 */
export function addWindowCost(windowId, costData) {
    const window = getToolWindow(windowId);
    if (!window) {
        stateDebug(`[Cost] Window ${windowId} not found for cost update`);
        return;
    }

    // Initialize cost arrays if they don't exist
    if (!window.costVersions) {
        window.costVersions = [];
    }
    if (!window.totalCost) {
        window.totalCost = { usd: 0, points: 0, ms2: 0, cult: 0 };
    }

    // Add cost to versions array
    window.costVersions.push({
        ...costData,
        timestamp: Date.now()
    });

    // Update total cost
    window.totalCost.usd += costData.usd || 0;
    window.totalCost.points += costData.points || 0;
    window.totalCost.ms2 += costData.ms2 || 0;
    window.totalCost.cult += costData.cult || 0;

    // Persist state
    persistState();

    // Dispatch cost update event
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('costUpdate', { 
            detail: { windowId, costData, totalCost: window.totalCost }
        }));
        stateDebug('[Cost] Dispatched costUpdate event for window:', windowId);
    } else {
        stateDebug('[Cost] Cost update (dispatchEvent not available):', { windowId, costData, totalCost: window.totalCost });
    }
    
    // Always try to update cost HUD directly as a fallback
    if (typeof window !== 'undefined' && window.costHUD && typeof window.costHUD.updateDisplay === 'function') {
        stateDebug('[Cost] Updating cost HUD via direct call');
        window.costHUD.updateDisplay();
    } else {
        stateDebug('[Cost] Cost HUD not available for update:', {
            windowAvailable: typeof window !== 'undefined',
            costHUDAvailable: !!(window && window.costHUD),
            updateDisplayAvailable: !!(window && window.costHUD && typeof window.costHUD.updateDisplay === 'function')
        });
    }
    
    // Also update the window cost display directly
    if (typeof window !== 'undefined' && window.updateWindowCostDisplay) {
        window.updateWindowCostDisplay(windowId);
    } else {
        // Fallback: try to update the DOM directly
        const windowEl = document.getElementById(windowId);
        if (windowEl) {
            const costElement = windowEl.querySelector('.window-cost-display .cost-amount');
            if (costElement) {
                const costData = getWindowCost(windowId);
                if (costData) {
                    const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
                    const points = Math.round((costData.totalCost.usd || 0) * (1 / USD_TO_POINTS_CONVERSION_RATE));
                    costElement.textContent = `${points} POINTS`;
                    stateDebug(`[Cost] Updated window ${windowId} cost display to ${points} POINTS`);
                }
            }
        }
    }
}

/**
 * Get cost data for a window
 * @param {string} windowId - Window ID
 * @returns {Object} Cost data with versions and totals
 */
export function getWindowCost(windowId) {
    const window = getToolWindow(windowId);
    if (!window) return null;

    return {
        costVersions: window.costVersions || [],
        totalCost: window.totalCost || { usd: 0, points: 0, ms2: 0, cult: 0 }
    };
}

/**
 * Get total cost across all windows
 * @returns {Object} Total cost across all windows
 */
export function getTotalWorkspaceCost() {
    const totals = { usd: 0, points: 0, ms2: 0, cult: 0 };
    
    stateDebug(`[getTotalWorkspaceCost] Processing ${activeToolWindows.length} windows`);
    
    activeToolWindows.forEach((window, index) => {
        stateDebug(`[getTotalWorkspaceCost] Window ${index}:`, {
            id: window.id,
            totalCost: window.totalCost,
            hasTotalCost: !!window.totalCost
        });
        
        if (window.totalCost) {
            totals.usd += window.totalCost.usd || 0;
            totals.points += window.totalCost.points || 0;
            totals.ms2 += window.totalCost.ms2 || 0;
            totals.cult += window.totalCost.cult || 0;
        }
    });

    stateDebug('[getTotalWorkspaceCost] Final totals:', totals);
    return totals;
}

/**
 * Reset cost data for a specific window
 * @param {string} windowId - Window ID
 */
export function resetWindowCost(windowId) {
    const window = getToolWindow(windowId);
    if (!window) return;

    window.costVersions = [];
    window.totalCost = { usd: 0, points: 0, ms2: 0, cult: 0 };
    
    persistState();

    // Dispatch cost reset event
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('costReset', { 
            detail: { windowId }
        }));
    }
}

/**
 * Reset cost data for all windows
 */
export function resetAllCosts() {
    activeToolWindows.forEach(window => {
        window.costVersions = [];
        window.totalCost = { usd: 0, points: 0, ms2: 0, cult: 0 };
    });
    
    persistState();

    // Dispatch global cost reset event
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('costResetAll'));
    }
}

// --- Generation Recovery System ---

/**
 * Get CSRF token for API requests
 */
async function getCsrfToken() {
    if (window.__csrfToken) return window.__csrfToken;
    try {
        const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (!res.ok) {
            throw new Error(`CSRF token fetch failed: ${res.status}`);
        }
        const data = await res.json();
        if (!data.csrfToken) {
            throw new Error('CSRF token not in response');
        }
        window.__csrfToken = data.csrfToken;
        return window.__csrfToken;
    } catch (e) {
        stateDebug('[getCsrfToken] error', e);
        throw new Error('Failed to get CSRF token. Please refresh the page.');
    }
}

/**
 * Check for completed pending generations and update windows
 * This is called on page load to recover from websocket disconnections
 */
export async function checkPendingGenerations() {
    const pendingGenerations = getPendingGenerations();
    const generationIds = Object.keys(pendingGenerations);
    
    if (generationIds.length === 0) {
        stateDebug('[PendingGen] No pending generations to check');
        return;
    }
    
    stateDebug('[PendingGen] Checking', generationIds.length, 'pending generations');
    
    try {
        // Get CSRF token for the request
        const csrfToken = await getCsrfToken();
        
        // Fetch generation statuses from the API
        const response = await fetch('/api/v1/generations/status', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken,
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify({ generationIds })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const completedGenerations = data.generations || [];
        
        // Process each completed generation
        for (const generation of completedGenerations) {
            const generationId = generation._id || generation.id;
            const pendingData = pendingGenerations[generationId];
            
            if (!pendingData) continue;
            
            stateDebug('[PendingGen] Found completed generation:', generationId, 'status:', generation.status);
            
            // Find the corresponding window
            const window = getToolWindow(pendingData.windowId);
            if (!window) {
                stateDebug('[PendingGen] Window not found for generation:', generationId, 'windowId:', pendingData.windowId);
                untrackPendingGeneration(generationId);
                continue;
            }
            
            // Update window with completed output
            if (generation.status === 'completed' || generation.status === 'success') {
                const outputData = {
                    type: 'recovered',
                    generationId: generationId,
                    ...generation.responsePayload
                };
                
                setToolWindowOutput(pendingData.windowId, outputData);
                
                // Update cost if available
                if (generation.costUsd) {
                    addWindowCost(pendingData.windowId, {
                        usd: generation.costUsd,
                        points: 0, // Will be calculated by cost system
                        ms2: 0,
                        cult: 0
                    });
                }
                
                stateDebug('[PendingGen] Updated window with completed generation:', pendingData.windowId);
            } else if (generation.status === 'failed') {
                // Handle failed generation
                const errorData = {
                    type: 'error',
                    generationId: generationId,
                    error: generation.errorDetails || 'Generation failed',
                    status: 'failed'
                };
                
                setToolWindowOutput(pendingData.windowId, errorData);
                stateDebug('[PendingGen] Updated window with failed generation:', pendingData.windowId);
            }
            
            // Remove from pending tracking
            untrackPendingGeneration(generationId);
        }
        
        // Clean up any generations that are no longer pending (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        for (const [generationId, pendingData] of Object.entries(pendingGenerations)) {
            const requestTime = new Date(pendingData.requestTimestamp);
            if (requestTime < oneHourAgo) {
                stateDebug('[PendingGen] Cleaning up old pending generation:', generationId);
                untrackPendingGeneration(generationId);
            }
        }
        
    } catch (error) {
        console.error('[PendingGen] Failed to check pending generations:', error);
        // Don't clear pending generations on error - they might still be valid
    }
}

// Expose for debugging in browser console
if (typeof window !== 'undefined') {
    window.getToolWindows = getToolWindows;
    window.activeToolWindows = activeToolWindows;
    window.getTotalWorkspaceCost = getTotalWorkspaceCost;
    window.resetAllCosts = resetAllCosts;
    window.getPendingGenerations = getPendingGenerations;
    window.checkPendingGenerations = checkPendingGenerations;
    window.clearPendingGenerations = clearPendingGenerations;
} 

const sandboxState = {
    toolWindows: [], // Array of active tool window data
    connections: [], // Array of active connection data
    availableTools: [], // All tools loaded from the server
    history: [], // For undo/redo
    historyIndex: -1,
    activeConnection: null, // Info about the connection being drawn
    connectionLine: null, // The DOM element for the connection line
    lastClickPosition: { x: 0, y: 0 },
    modal: { active: false, type: null, position: { x: 0, y: 0 } },
    submenu: { active: false, type: null, position: { x: 0, y: 0 } },
    selectedNodeIds: new Set(), // IDs of selected tool windows
    lasso: {
        active: false,
        x1: 0, y1: 0,
        x2: 0, y2: 0,
        element: null
    },
};

// --- History Management ---
// ... existing code ...
