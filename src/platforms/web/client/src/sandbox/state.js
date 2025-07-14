// Global state
export let availableTools = [];
export let activeToolWindows = [];
export let lastClickPosition = null;
export let activeConnection = null;
export let connectionLine = null;
export let activeModal = false;
export let activeSubmenu = false;

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

// Serialize and save state to localStorage
function persistState() {
    // Only store serializable data
    const serializableConnections = connections.map(({ element, ...rest }) => rest);
    const serializableWindows = activeToolWindows.map(w => {
        // Only persist id, tool.displayName, workspaceX, workspaceY, output
        return {
            id: w.id,
            displayName: w.tool?.displayName || '',
            workspaceX: w.workspaceX,
            workspaceY: w.workspaceY,
            output: w.output || null
        };
    });
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(serializableConnections));
    localStorage.setItem(TOOL_WINDOWS_KEY, JSON.stringify(serializableWindows));
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
            // Only restore window id, displayName, workspaceX, workspaceY, output
            const wins = JSON.parse(winRaw);
            activeToolWindows = wins.map(w => ({
                id: w.id,
                tool: { displayName: w.displayName },
                workspaceX: w.workspaceX,
                workspaceY: w.workspaceY,
                output: w.output || null
            }));
        } catch (e) { activeToolWindows = []; }
    }
}

// Patch add/remove/clear to persist
export function addConnection(connection) {
    connections.push(connection);
    persistState();
}

export function removeConnection(connectionId) {
    connections = connections.filter(c => c.id !== connectionId);
    persistState();
}

export function clearConnectionsForWindow(windowId) {
    connections = connections.filter(c => c.fromWindowId !== windowId && c.toWindowId !== windowId);
    persistState();
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
    loadState();
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

export function setLastClickPosition(position) {
    lastClickPosition = position;
}

export function getLastClickPosition() {
    return lastClickPosition;
}

export function setAvailableTools(tools) {
    console.log('Setting available tools:', tools);
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
        persistState();
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
                    console.log('Checking tool for image generation:', tool);
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
                    console.log('Checking tool for image transformation:', tool);
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
                    console.log('Checking tool for audio generation:', tool);
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
                    console.log('Checking tool for audio transformation:', tool);
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
                    console.log('Checking tool for text generation:', tool);
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
                    console.log('Checking tool for video generation:', tool);
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
                    console.log('Checking tool for video transformation:', tool);
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
    activeToolWindows.push(windowData);
    persistState();
}

export function removeToolWindow(windowId) {
    activeToolWindows = activeToolWindows.filter(w => w.id !== windowId);
    const windowEl = document.getElementById(windowId);
    if (windowEl) {
        windowEl.remove();
    }
    persistState();
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
        win.output = output;
        persistState();
    }
} 