/**
 * Main JavaScript for StationThis Bot Web Interface
 */

// Configuration
const API_BASE_URL = '/api';
const COMMAND_API_URL = `${API_BASE_URL}/commands`;
const HEALTH_API_URL = `${API_BASE_URL}/health`;
const STATUS_API_URL = `${API_BASE_URL}/status`;

// DOM Elements
const elements = {
    // Navigation
    navLinks: document.querySelectorAll('.header-nav a'),
    panels: document.querySelectorAll('.panel'),
    
    // Status and uptime
    uptimeEl: document.getElementById('uptime'),
    statusTextEl: document.getElementById('status-text'),
    statusDotEl: document.querySelector('.status-dot'),
    
    // Command panel
    commandSelect: document.getElementById('command-select'),
    commandArgs: document.getElementById('command-args'),
    apiKeyInput: document.getElementById('api-key'),
    userIdInput: document.getElementById('user-id'),
    executeButton: document.getElementById('execute-command'),
    clearResultButton: document.getElementById('clear-result'),
    commandResult: document.getElementById('command-result'),
    resultStatusIndicator: document.getElementById('result-status-indicator'),
    
    // Quick commands
    quickCommands: document.querySelectorAll('.quick-command'),
    
    // Status panel
    commandCountEl: document.getElementById('command-count'),
    sessionCountEl: document.getElementById('session-count'),
    versionEl: document.getElementById('version'),
    featureFlagsTable: document.getElementById('feature-flags-table').querySelector('tbody'),
    
    // Logs panel
    logsOutput: document.getElementById('logs-output'),
    clearLogsButton: document.getElementById('clear-logs')
};

// State
const state = {
    commands: [],
    logs: [],
    healthStatus: {},
    statusData: {}
};

// Utility Functions
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
}

function displayError(message) {
    elements.resultStatusIndicator.textContent = 'Error';
    elements.resultStatusIndicator.className = 'error';
    elements.commandResult.textContent = `Error: ${message}`;
}

function appendLog(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    state.logs.unshift(logEntry);
    
    // Limit logs to 100 entries
    if (state.logs.length > 100) {
        state.logs.pop();
    }
    
    // Update logs display
    elements.logsOutput.textContent = state.logs.join('\n');
}

// API Functions
async function fetchWithStatus(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API returned ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        appendLog('error', `API Error: ${error.message}`);
        throw error;
    }
}

async function fetchHealthStatus() {
    try {
        const data = await fetchWithStatus(HEALTH_API_URL);
        state.healthStatus = data;
        elements.uptimeEl.textContent = formatUptime(data.uptime);
        
        // Update status indicator
        if (data.status === 'ok') {
            elements.statusTextEl.textContent = 'Online';
            elements.statusDotEl.className = 'status-dot online';
        } else {
            elements.statusTextEl.textContent = 'Degraded';
            elements.statusDotEl.className = 'status-dot warning';
        }
    } catch (error) {
        elements.statusTextEl.textContent = 'Offline';
        elements.statusDotEl.className = 'status-dot offline';
        console.error('Failed to fetch health status:', error);
    }
}

async function fetchSystemStatus() {
    try {
        const data = await fetchWithStatus(STATUS_API_URL);
        state.statusData = data;
        
        // Update status panel
        elements.commandCountEl.textContent = data.components.commandRegistry ? 
            (data.commandCount || '?') : '0';
        elements.sessionCountEl.textContent = data.activeSessions || '0';
        elements.versionEl.textContent = data.version || '1.0.0';
        
        // Update feature flags table
        elements.featureFlagsTable.innerHTML = '';
        
        if (data.components.featureFlags) {
            const flags = data.components.featureFlags;
            Object.entries(flags).forEach(([key, value]) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${key}</td>
                    <td><span class="feature-${value ? 'enabled' : 'disabled'}">${value ? 'Enabled' : 'Disabled'}</span></td>
                `;
                elements.featureFlagsTable.appendChild(row);
            });
        }
        
        appendLog('info', 'System status updated');
    } catch (error) {
        console.error('Failed to fetch system status:', error);
    }
}

async function fetchCommands() {
    try {
        // For now, get commands from the status API since we don't have a dedicated endpoint
        const statusData = await fetchWithStatus(STATUS_API_URL);
        
        // Update command select
        elements.commandSelect.innerHTML = '<option value="">Select a command...</option>';
        
        if (statusData.commands) {
            state.commands = statusData.commands;
            statusData.commands.forEach(cmd => {
                const option = document.createElement('option');
                option.value = cmd.name;
                option.textContent = cmd.name + (cmd.description ? ` - ${cmd.description}` : '');
                elements.commandSelect.appendChild(option);
            });
        }
        
        appendLog('info', 'Commands loaded');
    } catch (error) {
        console.error('Failed to fetch commands:', error);
    }
}

async function executeCommand(commandName, args, userId) {
    elements.resultStatusIndicator.textContent = 'Executing...';
    elements.resultStatusIndicator.className = '';
    
    const apiKey = elements.apiKeyInput.value;
    
    try {
        const payload = typeof args === 'string' ? 
            (args.trim() ? JSON.parse(args) : {}) : args;
            
        appendLog('info', `Executing command: ${commandName}`);
        
        const response = await fetchWithStatus(`${COMMAND_API_URL}/${commandName}?userId=${userId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify(payload)
        });
        
        elements.resultStatusIndicator.textContent = response.status === 'ok' ? 'Success' : 'Failed';
        elements.resultStatusIndicator.className = response.status === 'ok' ? 'success' : 'error';
        elements.commandResult.textContent = JSON.stringify(response, null, 2);
        
        appendLog(response.status === 'ok' ? 'info' : 'warn', 
            `Command ${commandName} ${response.status === 'ok' ? 'succeeded' : 'failed'}`);
            
        return response;
    } catch (error) {
        elements.resultStatusIndicator.textContent = 'Error';
        elements.resultStatusIndicator.className = 'error';
        elements.commandResult.textContent = `Error: ${error.message}`;
        
        appendLog('error', `Command execution error: ${error.message}`);
        return { status: 'error', error: error.message };
    }
}

// Event Handlers
function setupNavigation() {
    elements.navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Remove active class from all links and panels
            elements.navLinks.forEach(l => l.classList.remove('active'));
            elements.panels.forEach(p => p.classList.remove('active'));
            
            // Add active class to clicked link and corresponding panel
            this.classList.add('active');
            const panel = document.getElementById(this.dataset.panel);
            if (panel) {
                panel.classList.add('active');
            }
            
            // If switching to status panel, refresh status
            if (this.dataset.panel === 'status-panel') {
                fetchSystemStatus();
            }
        });
    });
}

function setupCommandPanel() {
    // Execute command button
    elements.executeButton.addEventListener('click', async () => {
        const commandName = elements.commandSelect.value;
        if (!commandName) {
            displayError('Please select a command');
            return;
        }
        
        const args = elements.commandArgs.value;
        const userId = elements.userIdInput.value;
        
        if (!userId) {
            displayError('User ID is required');
            return;
        }
        
        try {
            await executeCommand(commandName, args, userId);
        } catch (error) {
            displayError(error.message);
        }
    });
    
    // Clear result button
    elements.clearResultButton.addEventListener('click', () => {
        elements.commandResult.textContent = 'No command executed yet.';
        elements.resultStatusIndicator.textContent = 'Ready';
        elements.resultStatusIndicator.className = '';
    });
    
    // Quick commands
    elements.quickCommands.forEach(button => {
        button.addEventListener('click', async () => {
            const commandName = button.dataset.command;
            const userId = elements.userIdInput.value;
            
            if (!userId) {
                displayError('User ID is required');
                return;
            }
            
            elements.commandSelect.value = commandName;
            await executeCommand(commandName, {}, userId);
        });
    });
}

function setupLogsPanel() {
    elements.clearLogsButton.addEventListener('click', () => {
        state.logs = [];
        elements.logsOutput.textContent = 'No logs available.';
    });
}

// Application initialization
function init() {
    // Load API key from localStorage if available
    const savedApiKey = localStorage.getItem('apiKey');
    if (savedApiKey) {
        elements.apiKeyInput.value = savedApiKey;
    }
    
    // Set up event listeners
    setupNavigation();
    setupCommandPanel();
    setupLogsPanel();
    
    // Save API key when changed
    elements.apiKeyInput.addEventListener('change', () => {
        localStorage.setItem('apiKey', elements.apiKeyInput.value);
        appendLog('info', 'API key saved to localStorage');
    });
    
    // Initial data fetch
    fetchHealthStatus();
    fetchSystemStatus();
    fetchCommands();
    
    // Set up polling for status updates
    setInterval(fetchHealthStatus, 10000); // Every 10 seconds
    setInterval(fetchSystemStatus, 30000); // Every 30 seconds
    
    appendLog('info', 'Interface initialized');
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', init); 