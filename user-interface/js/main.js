// DOM Elements
const workspaceGrid = document.getElementById('workspace-grid');
const commandInput = document.getElementById('command-input');
const commandSubmit = document.getElementById('command-submit');
const resultContainer = document.getElementById('result-container');
const commandModal = document.getElementById('command-modal');
const closeCommandModal = document.getElementById('close-command-modal');
const dateTimeDisplay = document.getElementById('date-time');
const uptimeDisplay = document.getElementById('uptime');
const toolButtons = document.querySelectorAll('.tool-btn');

// State
let appState = {
    selectedTool: null,
    uptime: 0,
    activeWorkspace: {
        width: 2,
        height: 1,
        selected: null
    },
    resources: {
        credits: 4250,
        energy: 75,
        computing: 42
    },
    commandHistory: []
};

// Initialize the application
function initApp() {
    updateDateTime();
    setupEventListeners();
    animateRadar();
    setInterval(updateDateTime, 60000); // Update time every minute
    setInterval(updateUptime, 1000); // Update uptime every second
}

// Setup all event listeners
function setupEventListeners() {
    // Tool buttons
    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const toolType = button.className.split(' ')[1].split('-')[0];
            selectTool(toolType, button);
        });
    });
    
    // Command input
    commandSubmit.addEventListener('click', (e) => {
        e.preventDefault();
        executeCommand(commandInput.value);
    });
    
    // Command input - Enter key
    commandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeCommand(commandInput.value);
        }
    });
    
    // Close modal
    closeCommandModal.addEventListener('click', () => {
        commandModal.classList.remove('visible');
    });
    
    // Workspace grid cells
    const gridCells = document.querySelectorAll('.grid-cell');
    gridCells.forEach(cell => {
        cell.addEventListener('click', () => {
            selectGridCell(cell);
        });
    });
}

// Select a tool
function selectTool(toolType, button) {
    // Deselect previous tool
    if (appState.selectedTool) {
        document.querySelector(`.${appState.selectedTool}-btn`).classList.remove('selected');
    }
    
    appState.selectedTool = toolType;
    button.classList.add('selected');
    
    // Display tool info
    displayToolInfo(toolType);
}

// Display tool info in the command modal
function displayToolInfo(toolType) {
    let toolInfo = '';
    
    switch(toolType) {
        case 'make':
            toolInfo = `
<h3>Make Tool</h3>
<p>Generate AI images from text prompts</p>
<p>Available models:</p>
<ul>
  <li>Stable Diffusion XL</li>
  <li>Midjourney v5</li>
  <li>DALL-E 3</li>
</ul>
<p>Points cost: 10-25 depending on model and settings</p>
`;
            break;
        case 'effect':
            toolInfo = `
<h3>Effect Tool</h3>
<p>Apply special effects and styles to existing images</p>
<p>Effects include:</p>
<ul>
  <li>Style transfer</li>
  <li>Color grading</li>
  <li>Artistic filters</li>
</ul>
<p>Points cost: 5-15 depending on effect complexity</p>
`;
            break;
        case 'rmbg':
            toolInfo = `
<h3>RMBG Tool</h3>
<p>Remove backgrounds from images with precision</p>
<p>Features:</p>
<ul>
  <li>One-click background removal</li>
  <li>Preserves fine details like hair</li>
  <li>Transparent output</li>
</ul>
<p>Points cost: 5 per image</p>
`;
            break;
        case 'upscale':
            toolInfo = `
<h3>Upscale Tool</h3>
<p>Enhance image resolution while preserving quality</p>
<p>Features:</p>
<ul>
  <li>Up to 4x upscaling</li>
  <li>Detail enhancement</li>
  <li>Artifact reduction</li>
</ul>
<p>Points cost: 8-15 depending on size</p>
`;
            break;
        case 'vidthat':
            toolInfo = `
<h3>VidThat Tool</h3>
<p>Convert images to short videos or animations</p>
<p>Options:</p>
<ul>
  <li>Cinematic pan and zoom</li>
  <li>Motion effects</li>
  <li>Animation from still images</li>
</ul>
<p>Points cost: 20-40 depending on length and effects</p>
`;
            break;
        case 'cheesethat':
            toolInfo = `
<h3>CheeseThat Tool</h3>
<p>Add fun and quirky elements to images</p>
<p>Features:</p>
<ul>
  <li>Meme generation</li>
  <li>Funny filters</li>
  <li>Pop culture elements</li>
</ul>
<p>Points cost: 8 per image</p>
`;
            break;
    }
    
    showCommandOutput(toolInfo);
}

// Display command output in modal
function showCommandOutput(content) {
    resultContainer.innerHTML = content;
    commandModal.classList.add('visible');
}

// Execute a command
function executeCommand(command) {
    if (!command) return;
    
    command = command.toLowerCase().trim();
    commandInput.value = '';
    
    // Add to command history
    appState.commandHistory.push(command);
    
    // Process command
    let output = '';
    
    switch(command) {
        case 'help':
            output = `
<h3>Available Commands</h3>
<ul>
  <li><strong>status</strong> - Display system status</li>
  <li><strong>tool [name]</strong> - Activate a specific tool</li>
  <li><strong>resources</strong> - Show available resources</li>
  <li><strong>refresh</strong> - Refresh the workspace</li>
  <li><strong>help</strong> - Display this help message</li>
</ul>
`;
            break;
            
        case 'status':
            output = `
<h3>System Status</h3>
<p>StationThis Control v1.0.0</p>
<p>User: Commander Alex (Level 7)</p>
<p>Points: 75/100</p>
<p>Charge: 3/5</p>
<p>Computing resources: ${appState.resources.computing}%</p>
<p>Uptime: ${formatUptime(appState.uptime)}</p>
`;
            break;
            
        case 'resources':
            output = `
<h3>Resource Status</h3>
<p>Credits: ${appState.resources.credits}</p>
<p>Energy: ${appState.resources.energy}%</p>
<p>Computing: ${appState.resources.computing}%</p>
<p>Available points: 75/100</p>
<p>Points recharge rate: 10 per hour</p>
`;
            break;
            
        case 'refresh':
            output = `<p>Refreshing workspace...</p>`;
            setTimeout(() => {
                showCommandOutput(`<p>Workspace refreshed successfully.</p>`);
            }, 1000);
            break;
            
        default:
            // Check if it's a tool command
            if (command.startsWith('tool ')) {
                const toolName = command.split(' ')[1];
                const toolButton = document.querySelector(`.${toolName}-btn`);
                
                if (toolButton) {
                    selectTool(toolName, toolButton);
                    return; // Don't show modal, the tool selection will do that
                } else {
                    output = `<p class="error-message">Unknown tool: "${toolName}"</p>`;
                }
            } else {
                output = `<p class="error-message">Unknown command: "${command}"</p>`;
            }
    }
    
    showCommandOutput(output);
}

// Select a grid cell
function selectGridCell(cell) {
    // Remove previous selection
    if (appState.activeWorkspace.selected) {
        document.querySelector(`.grid-cell[data-x="${appState.activeWorkspace.selected.x}"][data-y="${appState.activeWorkspace.selected.y}"]`)
            .classList.remove('selected');
    }
    
    // Set new selection
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    appState.activeWorkspace.selected = { x, y };
    
    cell.classList.add('selected');
    
    // If a tool is selected, show relevant options
    if (appState.selectedTool) {
        const content = `
<h3>Apply ${appState.selectedTool.charAt(0).toUpperCase() + appState.selectedTool.slice(1)} to Cell (${x},${y})</h3>
<p>Click confirm to apply this tool to the selected cell.</p>
<div style="margin-top: 15px;">
    <button id="apply-tool" style="background: var(--${appState.selectedTool}-color); color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">Apply ${appState.selectedTool.charAt(0).toUpperCase() + appState.selectedTool.slice(1)}</button>
    <button id="cancel-tool" style="background: transparent; border: 1px solid var(--border-color); color: var(--light-text); padding: 8px 15px; border-radius: 4px; margin-left: 10px; cursor: pointer;">Cancel</button>
</div>
`;
        showCommandOutput(content);
        
        // Add temporary event listeners
        setTimeout(() => {
            document.getElementById('apply-tool')?.addEventListener('click', () => {
                showCommandOutput(`<p>Applying ${appState.selectedTool} to cell (${x},${y})...</p><p>Processing...</p>`);
                
                // Simulate processing
                setTimeout(() => {
                    showCommandOutput(`<p>Successfully applied ${appState.selectedTool} to cell (${x},${y})!</p>`);
                    
                    // Update the cell to show something happened
                    const icon = document.createElement('i');
                    icon.className = 'fas fa-check-circle';
                    icon.style.color = `var(--${appState.selectedTool}-color)`;
                    icon.style.position = 'absolute';
                    icon.style.top = '10px';
                    icon.style.right = '10px';
                    icon.style.fontSize = '1.2rem';
                    cell.appendChild(icon);
                    
                    // Add a subtle pulsing animation
                    cell.style.animation = 'pulse 2s infinite';
                }, 2000);
            });
            
            document.getElementById('cancel-tool')?.addEventListener('click', () => {
                commandModal.classList.remove('visible');
            });
        }, 100);
    } else {
        // Just show cell info
        showCommandOutput(`<h3>Cell (${x},${y})</h3><p>No modifications have been applied to this cell.</p><p>Select a tool from the right panel to apply changes.</p>`);
    }
}

// Update date and time
function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        hour: '2-digit', 
        minute: '2-digit'
    };
    dateTimeDisplay.textContent = now.toLocaleString('en-US', options);
}

// Update uptime counter
function updateUptime() {
    appState.uptime++;
    uptimeDisplay.textContent = `Uptime: ${formatUptime(appState.uptime)}`;
}

// Animate radar sweep
function animateRadar() {
    // Add random radar dots occasionally
    setInterval(() => {
        if (Math.random() > 0.7) {
            const radarDots = document.querySelector('.radar-dots');
            if (radarDots) {
                const dot = document.createElement('div');
                dot.className = 'radar-dot';
                dot.style.top = `${Math.random() * 80 + 10}%`;
                dot.style.left = `${Math.random() * 80 + 10}%`;
                radarDots.appendChild(dot);
                
                // Remove the dot after the animation
                setTimeout(() => {
                    dot.remove();
                }, 3000);
            }
        }
    }, 2000);
}

// Format uptime seconds into human-readable format
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours}h ${minutes}m ${secs}s`;
}

// Add CSS for pulsing animation for processed cells
const style = document.createElement('style');
style.textContent = `
@keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
    70% { box-shadow: 0 0 0 5px rgba(59, 130, 246, 0); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}

.tool-btn.selected {
    background: var(--mech-button-hover);
    border-color: var(--primary-color);
    transform: translateY(-2px);
    box-shadow: var(--mech-border-glow);
}
`;
document.head.appendChild(style);

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', initApp); 