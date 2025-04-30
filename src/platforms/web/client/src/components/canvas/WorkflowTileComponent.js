// WorkflowTileComponent for the StationThis web interface
// Extends the basic TileComponent to add workflow execution functionality

import { TileComponent } from './TileComponent.js';
import { EventBus } from '../../stores/EventBus.js';
import { workflowService } from '../../services/WorkflowService.js';
import { dataTypeValidator } from './DataTypeValidator.js';

export class WorkflowTileComponent extends TileComponent {
  constructor(parentElement, options = {}) {
    // Initialize with workflow-specific defaults
    const workflowDefaults = {
      label: options.workflowType || 'Make Image',
      color: getWorkflowColor(options.workflowType),
      workflowType: options.workflowType || 'makeImage',
      parameters: options.parameters || {},
      results: options.results || null,
      cost: options.cost || 0,
      inputPorts: options.inputPorts || getDefaultInputPorts(options.workflowType),
      outputPorts: options.outputPorts || getDefaultOutputPorts(options.workflowType)
    };
    
    super(parentElement, { ...options, ...workflowDefaults });
    
    // Add workflow-specific state
    this.state = {
      ...this.state,
      workflowType: workflowDefaults.workflowType,
      parameters: workflowDefaults.parameters,
      results: workflowDefaults.results,
      cost: workflowDefaults.cost,
      isConfiguring: false,
      isExecuting: false,
      progress: 0,
      inputPorts: workflowDefaults.inputPorts,
      outputPorts: workflowDefaults.outputPorts
    };
    
    // Bind workflow-specific methods
    this.openConfigPanel = this.openConfigPanel.bind(this);
    this.closeConfigPanel = this.closeConfigPanel.bind(this);
    this.updateParameter = this.updateParameter.bind(this);
    this.executeWorkflow = this.executeWorkflow.bind(this);
    this.showResults = this.showResults.bind(this);
    this.handlePortClick = this.handlePortClick.bind(this);
    
    // Extend the template to include workflow-specific UI
    this.render();
  }
  
  template() {
    // Extend the base template with workflow-specific elements
    return `
      <div class="workflow-tile ${this.state.isExecuting ? 'executing' : ''}" 
           data-id="${this.state.id}"
           data-status="${this.state.status}"
           data-workflow="${this.state.workflowType}"
           style="left: ${this.state.x}px; 
                  top: ${this.state.y}px; 
                  width: ${this.state.width}px; 
                  height: ${this.state.height}px;
                  background-color: ${this.state.color};">
        <div class="tile-header">
          <span class="tile-label">${this.state.label}</span>
          <span class="tile-status">${this.state.status}</span>
          ${this.state.cost ? `<span class="tile-cost">${this.state.cost} pts</span>` : ''}
        </div>
        
        <div class="connection-ports input-ports">
          ${this.renderInputPorts()}
        </div>
        
        <div class="tile-content">
          ${this.renderContent()}
        </div>
        
        <div class="connection-ports output-ports">
          ${this.renderOutputPorts()}
        </div>
        
        ${this.state.isExecuting ? `
          <div class="execution-progress">
            <div class="progress-bar" style="width: ${this.state.progress}%"></div>
            <span>${Math.round(this.state.progress)}%</span>
          </div>
        ` : ''}
        <div class="tile-footer">
          ${!this.state.results ? `
            <button class="btn-configure">Configure</button>
            <button class="btn-execute" ${Object.keys(this.state.parameters).length === 0 ? 'disabled' : ''}>Execute</button>
          ` : `
            <button class="btn-view-results">View Results</button>
            <button class="btn-reset">Reset</button>
          `}
        </div>
        <div class="resize-handle top-left"></div>
        <div class="resize-handle top-right"></div>
        <div class="resize-handle bottom-left"></div>
        <div class="resize-handle bottom-right"></div>
      </div>
    `;
  }
  
  renderInputPorts() {
    if (!this.state.inputPorts || this.state.inputPorts.length === 0) {
      return '';
    }
    
    return this.state.inputPorts.map(port => `
      <div class="connection-port input-port" 
           data-port="${port.name}"
           data-type="input"
           data-datatype="${port.dataType}"
           title="${port.label}: ${port.description}">
        <div class="port-connector"></div>
        <span class="port-label">${port.label}</span>
      </div>
    `).join('');
  }
  
  renderOutputPorts() {
    if (!this.state.outputPorts || this.state.outputPorts.length === 0) {
      return '';
    }
    
    return this.state.outputPorts.map(port => `
      <div class="connection-port output-port" 
           data-port="${port.name}"
           data-type="output"
           data-datatype="${port.dataType}"
           title="${port.label}: ${port.description}">
        <span class="port-label">${port.label}</span>
        <div class="port-connector"></div>
      </div>
    `).join('');
  }
  
  renderContent() {
    if (this.state.results) {
      // Show result preview
      if (this.state.results.type === 'image') {
        return `<div class="result-preview"><img src="${this.state.results.url}" alt="Generated content"></div>`;
      } else if (this.state.results.type === 'text') {
        return `<div class="result-preview text-result">${this.state.results.content}</div>`;
      } else {
        return `<div class="result-preview">Result available</div>`;
      }
    } else if (Object.keys(this.state.parameters).length > 0) {
      // Show configured parameters
      const params = Object.entries(this.state.parameters)
        .map(([key, value]) => `<div class="param"><span>${key}:</span> ${truncateValue(value)}</div>`)
        .join('');
      
      return `<div class="parameters-summary">${params}</div>`;
    } else {
      // Show placeholder
      return `<div class="placeholder">Configure workflow parameters</div>`;
    }
  }
  
  init() {
    super.init();
    
    // Add workflow-specific event listeners after the element is in the DOM
    this.addWorkflowEventListeners();
  }
  
  addWorkflowEventListeners() {
    const configBtn = this.element.querySelector('.btn-configure');
    const executeBtn = this.element.querySelector('.btn-execute');
    const viewResultsBtn = this.element.querySelector('.btn-view-results');
    const resetBtn = this.element.querySelector('.btn-reset');
    
    if (configBtn) {
      configBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openConfigPanel();
      });
    }
    
    if (executeBtn) {
      executeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.executeWorkflow();
      });
    }
    
    if (viewResultsBtn) {
      viewResultsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showResults();
      });
    }
    
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetWorkflow();
      });
    }
    
    // Add event listeners to connection ports
    this.element.querySelectorAll('.connection-port').forEach(port => {
      port.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlePortClick(e);
      });
    });
  }
  
  handlePortClick(e) {
    const portElement = e.currentTarget;
    const portType = portElement.dataset.type;
    const portName = portElement.dataset.port;
    
    // Get port position relative to canvas
    const rect = portElement.getBoundingClientRect();
    const canvasRect = this.parent.getBoundingClientRect();
    const portPosition = {
      x: rect.left + rect.width / 2 - canvasRect.left,
      y: rect.top + rect.height / 2 - canvasRect.top
    };
    
    // Publish connection start event
    EventBus.publish('connection:start', {
      portElement,
      tileId: this.state.id,
      portType,
      portName,
      portPosition
    });
  }
  
  openConfigPanel() {
    // First get the workflow configuration options from the API
    workflowService.getWorkflowConfig(this.state.workflowType)
      .then(config => {
        // Calculate the initial cost estimate
        workflowService.calculatePointCost(this.state.workflowType, this.state.parameters)
          .then(cost => {
            // Publish event to open the workflow configuration panel
            EventBus.publish('workflow:configure', {
              tileId: this.state.id,
              workflowType: this.state.workflowType,
              currentParameters: this.state.parameters,
              configOptions: config.options || {},
              estimatedCost: cost,
              onSave: this.updateParameter
            });
            
            this.setState({ isConfiguring: true });
          })
          .catch(error => {
            console.error('Failed to calculate cost:', error);
            // Open config panel without cost estimate
            EventBus.publish('workflow:configure', {
              tileId: this.state.id,
              workflowType: this.state.workflowType,
              currentParameters: this.state.parameters,
              configOptions: config.options || {},
              onSave: this.updateParameter
            });
            
            this.setState({ isConfiguring: true });
          });
      })
      .catch(error => {
        console.error('Failed to get workflow config:', error);
        // Fallback to basic configuration
        EventBus.publish('workflow:configure', {
          tileId: this.state.id,
          workflowType: this.state.workflowType,
          currentParameters: this.state.parameters,
          onSave: this.updateParameter
        });
        
        this.setState({ isConfiguring: true });
      });
  }
  
  closeConfigPanel() {
    this.setState({ isConfiguring: false });
  }
  
  updateParameter(key, value) {
    if (typeof key === 'object') {
      // Handle bulk update
      this.setState({ 
        parameters: { ...this.state.parameters, ...key },
        isConfiguring: false
      });
    } else {
      // Handle single parameter update
      this.setState({
        parameters: { ...this.state.parameters, [key]: value }
      });
    }
    
    this.render();
    
    // Publish event that parameters were updated
    EventBus.publish('workflow:parameters:updated', {
      tileId: this.state.id,
      parameters: this.state.parameters
    });
  }
  
  async executeWorkflow() {
    if (Object.keys(this.state.parameters).length === 0) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Configure workflow parameters first'
      });
      return;
    }
    
    try {
      // Check if we have input connections and gather their data
      const inputConnections = await this.gatherInputData();
      
      // Update UI to show execution state
      this.setState({ 
        isExecuting: true,
        status: 'running',
        progress: 0
      });
      
      this.render();
      
      // Create an execution progress interval
      const progressInterval = setInterval(() => {
        // Simulate progress updates
        if (this.state.progress < 90) {
          this.setState({ progress: this.state.progress + 1 });
          this.updateProgressBar();
        }
      }, 500);
      
      // Add input data to parameters if available
      const requestParams = {
        ...this.state.parameters
      };
      
      if (inputConnections && Object.keys(inputConnections).length > 0) {
        requestParams.inputData = inputConnections;
      }
      
      // Execute the workflow using the workflow service
      const result = await workflowService.executeWorkflow({
        workflowType: this.state.workflowType,
        parameters: requestParams,
        tileId: this.state.id,
        inputData: inputConnections
      });
      
      // Clear the progress interval
      clearInterval(progressInterval);
      
      // Update tile with results
      this.setState({
        isExecuting: false,
        status: 'complete',
        progress: 100,
        results: result.data,
        cost: result.cost || this.state.cost
      });
      
      // Notify connected output tiles
      this.propagateOutputData();
      
      this.render();
      
      // Publish workflow complete event
      EventBus.publish('workflow:complete', {
        tileId: this.state.id,
        workflowType: this.state.workflowType,
        results: result.data
      });
      
    } catch (error) {
      this.setState({
        isExecuting: false,
        status: 'error',
        progress: 0
      });
      
      this.render();
      
      // Publish error event
      EventBus.publish('notification', {
        type: 'error',
        message: `Workflow execution failed: ${error.message}`
      });
    }
  }
  
  async gatherInputData() {
    // Request input connections from the connection system
    return new Promise(resolve => {
      EventBus.publish('workflow:getInputConnections', {
        tileId: this.state.id,
        callback: async (connections) => {
          if (!connections || connections.length === 0) {
            resolve({});
            return;
          }
          
          // Create a map of input port names to their data
          const inputData = {};
          let pendingConnections = connections.length;
          
          connections.forEach(connection => {
            // Request output data from the source tile
            EventBus.publish('workflow:getOutputData', {
              tileId: connection.sourceId,
              portName: connection.sourcePort,
              callback: async (data) => {
                if (data) {
                  // Get port types for data conversion if needed
                  let sourcePortType, targetPortType;
                  
                  // Request port type information through EventBus
                  EventBus.publish('workflow:getPortType', {
                    tileId: connection.sourceId,
                    portName: connection.sourcePort,
                    portDirection: 'output',
                    callback: (type) => {
                      sourcePortType = type;
                    }
                  });
                  
                  EventBus.publish('workflow:getPortType', {
                    tileId: connection.targetId,
                    portName: connection.targetPort,
                    portDirection: 'input',
                    callback: (type) => {
                      targetPortType = type;
                    }
                  });
                  
                  // Attempt data conversion if types are different
                  if (sourcePortType && targetPortType && sourcePortType !== targetPortType) {
                    const conversionResult = dataTypeValidator.convertData(
                      data,
                      sourcePortType,
                      targetPortType
                    );
                    
                    if (conversionResult.success) {
                      inputData[connection.targetPort] = conversionResult.data;
                      
                      // Log the conversion for debugging
                      console.log(`Converted data from ${sourcePortType} to ${targetPortType}`, {
                        before: data,
                        after: conversionResult.data
                      });
                    } else {
                      // Handle conversion failure
                      console.error(`Data conversion failed:`, conversionResult.error);
                      
                      // Show notification to user
                      EventBus.publish('notification', {
                        type: 'warning',
                        message: `Data conversion issue: ${conversionResult.error}`
                      });
                      
                      // Still use the original data, the workflow will have to handle it
                      inputData[connection.targetPort] = data;
                    }
                  } else {
                    // No conversion needed
                    inputData[connection.targetPort] = data;
                  }
                }
                
                pendingConnections--;
                if (pendingConnections === 0) {
                  resolve(inputData);
                }
              }
            });
          });
        }
      });
      
      // Set a timeout in case we don't get responses
      setTimeout(() => resolve({}), 1000);
    });
  }
  
  propagateOutputData() {
    if (!this.state.results) return;
    
    // Publish this tile's output data for any connected tiles
    EventBus.publish('workflow:outputDataAvailable', {
      tileId: this.state.id,
      outputs: this.getOutputData()
    });
  }
  
  getOutputData() {
    // Generate output data object based on output port definitions
    if (!this.state.results) return {};
    
    const outputs = {};
    const outputPorts = this.state.outputPorts || getDefaultOutputPorts(this.state.workflowType);
    
    // Map output ports to results data
    outputPorts.forEach(port => {
      if (this.state.results[port.key]) {
        outputs[port.name] = this.state.results[port.key];
      } else if (this.state.results[port.name]) {
        outputs[port.name] = this.state.results[port.name];
      }
    });
    
    // Return output data with port types for type checking
    return outputPorts.reduce((acc, port) => {
      if (outputs[port.name]) {
        acc[port.name] = {
          data: outputs[port.name],
          type: port.type || 'unknown'
        };
      }
      return acc;
    }, {});
  }
  
  /**
   * Get the data type for a specific port
   * @param {string} portName - Name of the port
   * @param {string} portDirection - Direction ('input' or 'output')
   * @returns {string} Port data type
   */
  getPortType(portName, portDirection) {
    const ports = portDirection === 'input' 
      ? (this.state.inputPorts || getDefaultInputPorts(this.state.workflowType))
      : (this.state.outputPorts || getDefaultOutputPorts(this.state.workflowType));
    
    const port = ports.find(p => p.name === portName);
    return port ? port.type : null;
  }
  
  updateProgressBar() {
    const progressBar = this.element.querySelector('.progress-bar');
    const progressText = this.element.querySelector('.execution-progress span');
    
    if (progressBar && progressText) {
      progressBar.style.width = `${this.state.progress}%`;
      progressText.textContent = `${Math.round(this.state.progress)}%`;
    }
  }
  
  showResults() {
    if (!this.state.results) return;
    
    // Add option to save to collection
    EventBus.publish('workflow:showResults', {
      tileId: this.state.id,
      results: this.state.results,
      onSave: (collectionId) => {
        workflowService.saveToCollection(this.state.results, collectionId)
          .then(result => {
            EventBus.publish('notification', {
              type: 'success',
              message: 'Result saved to collection'
            });
          })
          .catch(error => {
            EventBus.publish('notification', {
              type: 'error',
              message: `Failed to save to collection: ${error.message}`
            });
          });
      }
    });
  }
  
  resetWorkflow() {
    // Reset workflow to initial state
    this.setState({
      results: null,
      status: 'idle',
      progress: 0
    });
    
    this.render();
    
    // Publish workflow reset event
    EventBus.publish('workflow:reset', {
      tileId: this.state.id
    });
  }
  
  getAuthToken() {
    return localStorage.getItem('auth_token');
  }
  
  getData() {
    // Get tile data for saving workspace state
    return {
      ...super.getData(),
      workflowType: this.state.workflowType,
      parameters: this.state.parameters,
      results: this.state.results,
      cost: this.state.cost,
      inputPorts: this.state.inputPorts,
      outputPorts: this.state.outputPorts
    };
  }
}

function getWorkflowColor(workflowType) {
  // Return color based on workflow type
  const colors = {
    makeImage: '#297ACC',
    textToImage: '#4CAF50',
    imageToImage: '#FF9800',
    upscale: '#9C27B0',
    trainModel: '#F44336',
    textGeneration: '#2196F3',
    default: '#607D8B'
  };
  
  return colors[workflowType] || colors.default;
}

function truncateValue(value) {
  // Truncate long parameter values for display
  if (typeof value === 'string') {
    return value.length > 30 ? value.substring(0, 27) + '...' : value;
  } else if (typeof value === 'object') {
    return JSON.stringify(value).length > 30 ? 
      JSON.stringify(value).substring(0, 27) + '...' : 
      JSON.stringify(value);
  }
  return value;
}

function getDefaultInputPorts(workflowType) {
  // Generate default input ports based on workflow type
  switch (workflowType) {
    case 'generate-image':
      return [
        { name: 'prompt', label: 'Prompt', key: 'prompt', type: 'text' },
        { name: 'negativePrompt', label: 'Negative', key: 'negativePrompt', type: 'text' },
        { name: 'seed', label: 'Seed', key: 'seed', type: 'number' }
      ];
    case 'transform-image':
      return [
        { name: 'image', label: 'Image', key: 'image', type: 'image' },
        { name: 'prompt', label: 'Prompt', key: 'prompt', type: 'text' }
      ];
    case 'text-generator':
      return [
        { name: 'prompt', label: 'Prompt', key: 'prompt', type: 'text' },
        { name: 'context', label: 'Context', key: 'context', type: 'text' }
      ];
    case 'upscale':
      return [
        { name: 'image', label: 'Image', key: 'image', type: 'image' },
        { name: 'scale', label: 'Scale', key: 'scale', type: 'number' }
      ];
    case 'data-converter':
      return [
        { name: 'input', label: 'Input', key: 'input', type: 'object' }
      ];
    case 'collection':
      return [
        { name: 'item', label: 'Item', key: 'item', type: 'media' }
      ];
    default:
      return [
        { name: 'input', label: 'Input', key: 'input', type: 'object' }
      ];
  }
}

function getDefaultOutputPorts(workflowType) {
  // Generate default output ports based on workflow type
  switch (workflowType) {
    case 'generate-image':
      return [
        { name: 'image', label: 'Image', key: 'image', type: 'image' },
        { name: 'metadata', label: 'Metadata', key: 'metadata', type: 'object' }
      ];
    case 'transform-image':
      return [
        { name: 'image', label: 'Image', key: 'image', type: 'image' }
      ];
    case 'text-generator':
      return [
        { name: 'text', label: 'Text', key: 'text', type: 'text' },
        { name: 'metadata', label: 'Metadata', key: 'metadata', type: 'object' }
      ];
    case 'upscale':
      return [
        { name: 'image', label: 'Image', key: 'image', type: 'image' }
      ];
    case 'data-converter':
      return [
        { name: 'output', label: 'Output', key: 'output', type: 'object' },
        { name: 'text', label: 'Text', key: 'text', type: 'text' },
        { name: 'number', label: 'Number', key: 'number', type: 'number' }
      ];
    case 'collection':
      return [
        { name: 'collection', label: 'Collection', key: 'collection', type: 'collection' }
      ];
    default:
      return [
        { name: 'output', label: 'Output', key: 'output', type: 'object' }
      ];
  }
} 