import { OUTPUT_TYPE_MAPPING, getAvailableTools, activeToolWindows, getActiveConnection, setActiveConnection } from './state.js';
import { createToolWindow } from './node.js';
import { createPermanentConnection } from './connections.js';
import { hideModal, calculateCenterPosition, getToolInputTypes } from './utils.js';

// Creation type to category mapping
const CREATION_TYPE_TO_CATEGORY = {
    'image': 'text-to-image',
    'sound': 'text-to-audio',
    'text': 'text-to-text',
    'movie': 'text-to-video'
};

export function renderSidebarTools() {
    const toolsContainer = document.querySelector('.tools-container');
    const tools = getAvailableTools();

    if (!toolsContainer) return;
    if (!tools || tools.length === 0) {
        toolsContainer.innerHTML = '<p style="color: #aaa; padding: 10px;">No tools loaded.</p>';
        return;
    }

    // Clear existing content
    toolsContainer.innerHTML = '';

    // Group tools by category
    const toolsByCategory = tools.reduce((acc, tool) => {
        const category = tool.category || 'uncategorized';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(tool);
        return acc;
    }, {});

    // Create category sections
    Object.entries(toolsByCategory).forEach(([category, categoryTools]) => {
        const categoryHeader = document.createElement('h4');
        categoryHeader.textContent = category
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        categoryHeader.style.margin = '16px 0 8px';
        categoryHeader.style.color = 'rgba(255, 255, 255, 0.9)';
        categoryHeader.style.fontFamily = 'monospace';
        toolsContainer.appendChild(categoryHeader);

        // Add tools for this category
        categoryTools.forEach(tool => {
            const toolButton = document.createElement('button');
            toolButton.className = 'tool-button';
            toolButton.style.cssText = `
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 12px;
                margin: 4px 0;
                cursor: pointer;
                text-align: left;
                width: 100%;
                transition: all 0.2s ease;
                color: white;
            `;

            const name = document.createElement('div');
            name.textContent = tool.displayName;
            name.style.fontFamily = 'monospace';
            name.style.marginBottom = '4px';

            const description = document.createElement('div');
            description.textContent = tool.description.split('.')[0]; // First sentence
            description.style.fontSize = '0.8em';
            description.style.color = 'rgba(255, 255, 255, 0.6)';
            description.style.lineHeight = '1.4';

            toolButton.appendChild(name);
            toolButton.appendChild(description);

            toolButton.addEventListener('mouseenter', () => {
                toolButton.style.background = 'rgba(255, 255, 255, 0.1)';
                toolButton.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            });
            toolButton.addEventListener('mouseleave', () => {
                toolButton.style.background = 'rgba(255, 255, 255, 0.05)';
                toolButton.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            });

            toolButton.addEventListener('click', () => {
                const position = calculateCenterPosition(activeToolWindows);
                createToolWindow(tool, position);
            });

            toolsContainer.appendChild(toolButton);
        });
    });
}

export function showToolsForConnection(connectionType, x, y) {
    const allTools = getAvailableTools();
    const compatibleTools = allTools.filter(tool => {
        const inputTypes = getToolInputTypes(tool);
        return inputTypes.includes(connectionType);
    });

    const modal = document.createElement('div');
    modal.className = 'output-tools-modal';
    modal.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 16px;
        color: white;
        font-family: monospace;
        z-index: 1001;
        min-width: 240px;
    `;

    const header = document.createElement('div');
    header.textContent = `Connect ${connectionType} to...`;
    header.style.cssText = `
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 12px;
        font-weight: bold;
        font-size: 1.1em;
    `;
    modal.appendChild(header);

    if (compatibleTools.length > 0) {
        compatibleTools.forEach(tool => {
            const button = document.createElement('button');
            button.style.cssText = `
                width: 100%;
                padding: 12px;
                margin: 4px 0;
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: white;
                cursor: pointer;
                text-align: left;
                font-family: monospace;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 12px;
            `;

            const emoji = document.createElement('div');
            emoji.style.cssText = `
                font-size: 1.5em;
                min-width: 24px;
                text-align: center;
            `;
            emoji.textContent = '🔗';
            button.appendChild(emoji);

            const textContent = document.createElement('div');
            textContent.innerHTML = `
                <div style="font-weight: bold;">${tool.displayName}</div>
                <div style="font-size:0.8em; color: #aaa;">${tool.description.split('.')[0]}</div>
            `;
            button.appendChild(textContent);

            button.addEventListener('click', () => {
                const newWindow = createToolWindow(tool, { x, y });
                modal.remove();
                const activeConn = getActiveConnection();
                if (activeConn && activeConn.fromWindow) {
                    setTimeout(() => {
                        createPermanentConnection(activeConn.fromWindow, newWindow, activeConn.outputType);
                    }, 0);
                }
                setActiveConnection(null);
            });
            modal.appendChild(button);
        });
    } else {
        modal.innerHTML += '<p style="padding: 8px;">No compatible tools found.</p>';
    }
    
    document.body.appendChild(modal);

    // Clamp modal position to viewport
    const margin = 16;
    const rect = modal.getBoundingClientRect();
    let newLeft = rect.left, newTop = rect.top;
    if (rect.left < margin) newLeft = margin;
    if (rect.top < margin) newTop = margin;
    if (rect.right > window.innerWidth - margin) newLeft = window.innerWidth - rect.width - margin;
    if (rect.bottom > window.innerHeight - margin) newTop = window.innerHeight - rect.height - margin;
    modal.style.left = `${newLeft + rect.width / 2}px`;
    modal.style.top = `${newTop + rect.height / 2}px`;

    function handleClickOutside(e) {
        if (!modal.contains(e.target)) {
            modal.remove();
            setActiveConnection(null);
            document.removeEventListener('click', handleClickOutside);
        }
    }
    setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
    }, 0);
}

export function showToolsForCategory(type, x, y) {
    console.log('showToolsForCategory called with type:', type);
    
    const category = CREATION_TYPE_TO_CATEGORY[type];
    if (!category) {
        console.error('No category mapping found for type:', type);
        return;
    }

    const typeConfig = OUTPUT_TYPE_MAPPING[type];
    if (!typeConfig) {
        console.error('No type config found for type:', type);
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'output-tools-modal';
    modal.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 16px;
        color: white;
        font-family: monospace;
        z-index: 1001;
        min-width: 240px;
    `;

    const header = document.createElement('div');
    header.textContent = typeConfig.modalTitle;
    header.style.cssText = `
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 12px;
        font-weight: bold;
        font-size: 1.1em;
    `;
    modal.appendChild(header);

    const categoryTools = getAvailableTools().filter(tool => tool.category === category);

    if (categoryTools.length > 0) {
        categoryTools.forEach(tool => {
            const button = document.createElement('button');
            button.style.cssText = `
                width: 100%;
                padding: 12px;
                margin: 4px 0;
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: white;
                cursor: pointer;
                text-align: left;
                font-family: monospace;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 12px;
            `;

            const emoji = document.createElement('div');
            emoji.style.cssText = `
                font-size: 1.5em;
                min-width: 24px;
                text-align: center;
            `;
            emoji.textContent = typeConfig.emoji;
            button.appendChild(emoji);

            const textContent = document.createElement('div');
            textContent.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 4px;">${tool.displayName}</div>
                <div style="font-size: 0.8em; color: rgba(255, 255, 255, 0.6);">
                    ${tool.description.split('.')[0]}
                </div>
            `;
            button.appendChild(textContent);

            button.addEventListener('click', () => {
                createToolWindow(tool, { x, y });
                modal.remove();
                setActiveConnection(null);
            });

            modal.appendChild(button);
        });
    } else {
         modal.innerHTML += '<p>No tools in this category.</p>';
    }

    document.body.appendChild(modal);

    // Clamp modal position to viewport
    const margin = 16;
    const rect = modal.getBoundingClientRect();
    let newLeft = rect.left, newTop = rect.top;
    if (rect.left < margin) newLeft = margin;
    if (rect.top < margin) newTop = margin;
    if (rect.right > window.innerWidth - margin) newLeft = window.innerWidth - rect.width - margin;
    if (rect.bottom > window.innerHeight - margin) newTop = window.innerHeight - rect.height - margin;
    modal.style.left = `${newLeft + rect.width / 2}px`;
    modal.style.top = `${newTop + rect.height / 2}px`;

    function handleClickOutside(e) {
        if (!modal.contains(e.target)) {
            modal.remove();
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        }
    }
    function handleEscape(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        }
    }
    setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
    }, 0);
}
