import { getToolWindows, getConnections } from './state.js';

export function serializeSubgraph(selectedNodeIds) {
    const allWindows = getToolWindows();
    const allConnections = getConnections();

    const selectedWindows = allWindows.filter(win => selectedNodeIds.has(win.id));
    const selectedConnections = allConnections.filter(conn =>
        selectedNodeIds.has(conn.fromWindowId) && selectedNodeIds.has(conn.toWindowId)
    );

    return {
        nodes: selectedWindows.map(win => ({
            id: win.id,
            displayName: win.tool.displayName,
            toolId: win.tool.toolId,
            workspaceX: win.workspaceX,
            workspaceY: win.workspaceY,
            output: win.output,
            parameterMappings: win.parameterMappings
        })),
        connections: selectedConnections.map(conn => ({
            fromWindowId: conn.fromWindowId,
            fromOutput: conn.fromOutput,
            toWindowId: conn.toWindowId,
toInput: conn.toInput,
            type: conn.type
        }))
    };
}
