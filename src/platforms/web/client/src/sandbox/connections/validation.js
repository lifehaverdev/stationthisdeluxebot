import { getConnections, getToolWindows } from '../state.js';

// Utility: check if adding a connection would create a cycle
export function wouldCreateCycle({ fromWindowId, toWindowId }) {
    // Build adjacency list from current connections
    const adj = {};
    getConnections().forEach(conn => {
        if (!adj[conn.fromWindowId]) adj[conn.fromWindowId] = [];
        adj[conn.fromWindowId].push(conn.toWindowId);
    });
    // Add the proposed connection
    if (!adj[fromWindowId]) adj[fromWindowId] = [];
    adj[fromWindowId].push(toWindowId);
    // DFS to see if toWindowId can reach fromWindowId
    const visited = new Set();
    function dfs(node) {
        if (node === fromWindowId) return true;
        if (visited.has(node)) return false;
        visited.add(node);
        const neighbors = adj[node] || [];
        for (const neighbor of neighbors) {
            if (dfs(neighbor)) return true;
        }
        return false;
    }
    return dfs(toWindowId);
}

// Utility: check if output type is compatible with input type
export function areTypesCompatible({ fromWindowId, toWindowId, type }) {
    // Find source and target tool windows
    const toolWindows = getToolWindows();
    const fromWin = toolWindows.find(w => w.id === fromWindowId);
    const toWin = toolWindows.find(w => w.id === toWindowId);
    if (!fromWin || !toWin) return false;
    const fromTool = fromWin.tool;
    const toTool = toWin.tool;
    // Use inputSchema if available
    if (toTool.inputSchema) {
        // Helper to normalise parameter types (aliases, arrays, etc.)
        const normalise = (t) => {
            if (Array.isArray(t)) t = t[0];
            if (t === 'string' || t === 'textany') return 'text';
            return t;
        };

        const desiredType = normalise(type);

        // Check if any input parameter accepts the desired type
        for (const [, param] of Object.entries(toTool.inputSchema)) {
            const paramTypes = Array.isArray(param.type) ? param.type : [param.type];
            const matches = paramTypes.some(pt => normalise(pt) === desiredType);
            if (matches) return true;

            // Allow for explicit allowedTypes array
            if (param.allowedTypes && param.allowedTypes.map(normalise).includes(desiredType)) {
                return true;
            }
        }
        return false;
    }
    // Fallback: check metadata
    if (toTool.metadata && toTool.metadata.inputType) {
        if (Array.isArray(toTool.metadata.inputType)) {
            return toTool.metadata.inputType.includes(type);
        } else {
            return toTool.metadata.inputType === type;
        }
    }
    // If no schema, allow by default (legacy tools)
    return true;
}

// Utility: check if a connection target is valid
export function isValidConnectionTarget({ fromWindowId, toAnchor, type }) {
    if (!toAnchor) return false; // Should not happen if called correctly
    
    const toWindow = toAnchor.closest('.tool-window');
    if (!toWindow) return false; // Should not happen either

    // 1. Check for self-connection
    if (toWindow.id === fromWindowId) {
        alert('Cannot connect a node to itself.');
        return false;
    }

    // 2. Check for cycles
    if (wouldCreateCycle({ fromWindowId, toWindowId: toWindow.id })) {
        alert('Cannot create connection: this would create a cycle in the graph.');
        return false;
    }

    // 3. Check for basic type compatibility
    const anchorType = toAnchor.dataset.type;
    if (anchorType !== type) {
        alert(`Cannot connect: Type mismatch. Output is '${type}' but input requires '${anchorType}'.`);
        return false;
    }

    // 4. Check for advanced type compatibility (using schemas)
    if (!areTypesCompatible({ fromWindowId, toWindowId: toWindow.id, type })) {
        alert('Cannot connect: The output type is not compatible with any of the target node\'s inputs.');
        return false;
    }

    return true;
} 