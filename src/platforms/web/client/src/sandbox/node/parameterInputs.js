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
            const toolWindow = getToolWindow(container.closest('.tool-window').id);
            if (toolWindow && toolWindow.parameterMappings[key]) {
                toolWindow.parameterMappings[key].value = e.target.value;
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