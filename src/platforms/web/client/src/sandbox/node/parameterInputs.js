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

    // Utility to update mapping and versioning when value changes
    const handleChange = (value, containerEl) => {
        const toolWindowEl = containerEl.closest('.tool-window');
        const toolWindow = getToolWindow(toolWindowEl.id);
        if (toolWindow && toolWindow.parameterMappings[key]) {
            toolWindow.parameterMappings[key].value = value;

            // --- Versioning logic (kept from original) ---
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
    };

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
        const sourceName = sourceNode ? ((sourceNode.tool && sourceNode.tool.displayName) || sourceNode.displayName || mapping.nodeId) : mapping.nodeId;
        sourceLabel.textContent = `from: ${sourceName}.${mapping.outputKey}`;
        sourceLabel.style.fontStyle = 'italic';
        container.appendChild(sourceLabel);

    } else {
        // Static input as normal
        const label = document.createElement('label');
        label.textContent = param.name;

        let inputEl;
        if (Array.isArray(param.enum) && param.enum.length) {
            // Enum -> create select dropdown
            const select = document.createElement('select');
            select.name = key;
            param.enum.forEach(opt => {
                const optionEl = document.createElement('option');
                optionEl.value = opt;
                optionEl.textContent = opt;
                select.appendChild(optionEl);
            });
            select.value = mapping && mapping.value !== undefined ? mapping.value : (param.default || param.enum[0]);
            select.addEventListener('change', (e) => handleChange(e.target.value, container));
            inputEl = select;
        } else {
            // Fallback to text/number input
            const input = document.createElement('input');
            input.type = param.type === 'number' || param.type === 'integer' ? 'number' : 'text';
            input.name = key;
            input.value = mapping && mapping.value !== undefined ? mapping.value : (param.default || '');
            input.placeholder = param.description || param.name;
            input.addEventListener('input', (e) => handleChange(e.target.value, container));
            inputEl = input;
        }

        container.append(label, inputEl);

        // --- Conditional visibility ---
        if (param.visibleIf && param.visibleIf.field && Array.isArray(param.visibleIf.values)) {
            const dependentField = param.visibleIf.field;
            const updateVisibility = () => {
                const root = container.closest('.tool-window');
                if (!root) return;
                const depEl = root.querySelector(`[name="${dependentField}"]`);
                if (!depEl) return;
                const depValue = depEl.value;
                const shouldShow = param.visibleIf.values.includes(depValue);
                container.style.display = shouldShow ? '' : 'none';
            };

            // Initial toggle after DOM attach microtask
            setTimeout(updateVisibility, 0);

            // Listen for changes on dependent field
            container.addEventListener('visibilityCheck', updateVisibility);
            // Attach listener to dep field
            const root = document;
            setTimeout(() => {
                const depEl = container.closest('.tool-window')?.querySelector(`[name="${dependentField}"]`);
                if (depEl) {
                    depEl.addEventListener('change', updateVisibility);
                    depEl.addEventListener('input', updateVisibility);
                }
            }, 0);
        }
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