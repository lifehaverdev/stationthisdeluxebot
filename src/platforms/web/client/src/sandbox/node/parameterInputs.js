import { getToolWindow } from '../state.js';

// Create parameter section
export function createParameterSection(params, className, parameterMappings, toolWindows) {
    const section = document.createElement('div');
    section.className = className;

    params.forEach(([key, param]) => {
        const mapping = parameterMappings && parameterMappings[key];
        const input = createParameterInput(key, param, mapping, toolWindows);
        section.appendChild(input);
    });

    return section;
}

// Create parameter input
function createParameterInput(key, param, mapping, toolWindows) {
    const container = document.createElement('div');
    container.className = 'parameter-input';
    container.dataset.paramName = key;

    // If mapped to node output, show as connected
    if (mapping && mapping.type === 'nodeOutput') {
        container.classList.add('parameter-connected');
        // Show connection info
        const label = document.createElement('span');
        label.textContent = `${param.name} (connected)`;
        label.style.fontWeight = 'bold';
        label.style.marginRight = '8px';
        container.appendChild(label);

        // Show source node/output info
        const sourceLabel = document.createElement('span');
        const sourceNode = toolWindows && toolWindows.find(w => w.id === mapping.nodeId);
        const sourceName = sourceNode ? (sourceNode.tool.displayName || mapping.nodeId) : mapping.nodeId;
        sourceLabel.textContent = `from: ${sourceName}.${mapping.outputKey}`;
        sourceLabel.style.fontStyle = 'italic';
        container.appendChild(sourceLabel);

    } else {
        // Static input as normal
        const label = document.createElement('label');
        label.textContent = param.name;

        const input = document.createElement('input');
        input.type = param.type === 'number' || param.type === 'integer' ? 'number' : 'text';
        input.name = key;
        input.value = mapping && mapping.value !== undefined ? mapping.value : (param.default || '');
        input.placeholder = param.description || param.name;

        input.addEventListener('input', (e) => {
            const toolWindowEl = container.closest('.tool-window');
            const toolWindow = getToolWindow(toolWindowEl.id);
            if (toolWindow && toolWindow.parameterMappings[key]) {
                toolWindow.parameterMappings[key].value = e.target.value;

                // --- Versioning: create new pending version on parameter change ---
                if (!Array.isArray(toolWindow.outputVersions)) {
                    toolWindow.outputVersions = [];
                }
                const needsNewVersion = toolWindow.outputVersions.length === 0 ||
                    (toolWindow.currentVersionIndex !== toolWindow.outputVersions.length - 1) ||
                    (toolWindow.outputVersions[toolWindow.outputVersions.length - 1] && !toolWindow.outputVersions[toolWindow.outputVersions.length - 1]._pending);

                if (needsNewVersion) {
                    const snapshot = JSON.parse(JSON.stringify(toolWindow.parameterMappings));
                    const placeholder = { _pending: true, type: 'pending', params: snapshot };
                    toolWindow.outputVersions.push(placeholder);
                    toolWindow.currentVersionIndex = toolWindow.outputVersions.length - 1;
                } else {
                    // Update snapshot of existing pending version
                    const lastIdx = toolWindow.outputVersions.length - 1;
                    if (toolWindow.outputVersions[lastIdx] && toolWindow.outputVersions[lastIdx]._pending) {
                        toolWindow.outputVersions[lastIdx].params = JSON.parse(JSON.stringify(toolWindow.parameterMappings));
                    }
                }

                // Refresh version selector UI if present
                if (typeof document !== 'undefined') {
                    if (toolWindowEl.versionSelector && toolWindowEl.versionSelector.querySelector) {
                        const btn = toolWindowEl.versionSelector.querySelector('.version-button');
                        if (btn && typeof btn.refreshDropdown === 'function') {
                            btn.refreshDropdown();
                        }
                    }
                }
            }
        });

        container.append(label, input);
    }
    return container;
}

export function showError(toolWindow, message) {
    let errorDiv = toolWindow.querySelector('.tool-error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'tool-error-message';
        errorDiv.style.color = 'red';
        errorDiv.style.marginTop = '8px';
        toolWindow.appendChild(errorDiv);
    }
    errorDiv.textContent = message;
} 