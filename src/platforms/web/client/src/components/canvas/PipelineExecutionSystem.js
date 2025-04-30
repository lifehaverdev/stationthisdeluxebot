// PipelineExecutionSystem for StationThis web interface
// Manages the execution of workflow pipelines with proper dependency handling

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';

export class PipelineExecutionSystem extends Component {
  constructor(canvasElement) {
    super(canvasElement);
    
    // Pipeline system state
    this.state = {
      activePipeline: null,
      executionQueue: [],
      executionInProgress: false,
      currentExecutingTile: null,
      pipelineProgress: 0,
      executionHistory: [],
      pipelineTemplates: [],
      showingTemplateSaveModal: false,
      currentTemplateId: null,
      currentTemplateName: ''
    };
    
    // Reference to connection system
    this.connectionSystem = null;
    
    // Bind methods
    this.detectPipeline = this.detectPipeline.bind(this);
    this.executePipeline = this.executePipeline.bind(this);
    this.executeTile = this.executeTile.bind(this);
    this.cancelPipeline = this.cancelPipeline.bind(this);
    this.handlePipelineExecutionRequest = this.handlePipelineExecutionRequest.bind(this);
    this.handleWorkflowExecutionComplete = this.handleWorkflowExecutionComplete.bind(this);
    this.handleWorkflowExecutionFailed = this.handleWorkflowExecutionFailed.bind(this);
    this.updatePipelineProgress = this.updatePipelineProgress.bind(this);
    this.handlePortTypeRequest = this.handlePortTypeRequest.bind(this);
    this.savePipelineAsTemplate = this.savePipelineAsTemplate.bind(this);
    this.loadPipelineTemplate = this.loadPipelineTemplate.bind(this);
    this.handleSaveTemplateClick = this.handleSaveTemplateClick.bind(this);
    this.handleSaveModalClose = this.handleSaveModalClose.bind(this);
    this.handlePipelineTemplateRequest = this.handlePipelineTemplateRequest.bind(this);
    this.loadPipelineTemplates = this.loadPipelineTemplates.bind(this);
    this.handleGetTemplates = this.handleGetTemplates.bind(this);
    this.handleUpdateTemplates = this.handleUpdateTemplates.bind(this);
    
    // Initialize the pipeline system
    this.init();
  }
  
  template() {
    return `
      <div class="pipeline-execution-system">
        ${this.state.executionInProgress ? `
          <div class="pipeline-progress-overlay">
            <div class="pipeline-progress">
              <div class="progress-label">Pipeline Execution: ${Math.round(this.state.pipelineProgress)}%</div>
              <div class="progress-bar">
                <div class="progress-value" style="width: ${this.state.pipelineProgress}%"></div>
              </div>
              <div class="progress-status">
                Executing: ${this.state.currentExecutingTile ? `Tile #${this.state.currentExecutingTile}` : 'None'}
              </div>
              <button class="btn-cancel-pipeline">Cancel Pipeline</button>
            </div>
          </div>
        ` : ''}
        ${this.state.showingTemplateSaveModal ? `
          <div class="template-save-modal-overlay">
            <div class="template-save-modal">
              <h3>Save Pipeline as Template</h3>
              <div class="template-form">
                <label for="template-name">Template Name:</label>
                <input type="text" id="template-name" value="${this.state.currentTemplateName}" placeholder="My Pipeline Template">
                <div class="template-actions">
                  <button class="btn-save-template">Save</button>
                  <button class="btn-cancel-template">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Subscribe to pipeline execution events
    EventBus.subscribe('pipeline:execute', this.handlePipelineExecutionRequest);
    EventBus.subscribe('workflow:execution:complete', this.handleWorkflowExecutionComplete);
    EventBus.subscribe('workflow:execution:failed', this.handleWorkflowExecutionFailed);
    EventBus.subscribe('workflow:getPortType', this.handlePortTypeRequest);
    EventBus.subscribe('pipeline:saveAsTemplate', this.handlePipelineTemplateRequest);
    EventBus.subscribe('pipeline:loadTemplate', this.loadPipelineTemplate);
    EventBus.subscribe('pipeline:getTemplates', this.handleGetTemplates.bind(this));
    EventBus.subscribe('pipeline:updateTemplates', this.handleUpdateTemplates.bind(this));
    
    // Add cancel button event listener when pipeline is running
    if (this.state.executionInProgress) {
      const cancelBtn = this.element.querySelector('.btn-cancel-pipeline');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', this.cancelPipeline);
      }
    }
    
    // Add save template modal event listeners
    if (this.state.showingTemplateSaveModal) {
      const saveBtn = this.element.querySelector('.btn-save-template');
      const cancelBtn = this.element.querySelector('.btn-cancel-template');
      const nameInput = this.element.querySelector('#template-name');
      
      if (saveBtn) {
        saveBtn.addEventListener('click', this.handleSaveTemplateClick);
      }
      
      if (cancelBtn) {
        cancelBtn.addEventListener('click', this.handleSaveModalClose);
      }
      
      if (nameInput) {
        nameInput.addEventListener('input', (e) => {
          this.setState({ currentTemplateName: e.target.value });
        });
        nameInput.focus();
      }
    }
    
    // Try to get connection system reference
    EventBus.publish('canvas:getConnectionSystem', (connectionSystem) => {
      this.connectionSystem = connectionSystem;
    });
    
    // Load saved pipeline templates
    this.loadPipelineTemplates();
  }
  
  /**
   * Detects a pipeline by analyzing connections starting from a specific tile
   * @param {string} startTileId - The ID of the tile to start pipeline detection from
   * @returns {Object} Pipeline object with execution order and metadata
   */
  detectPipeline(startTileId) {
    if (!this.connectionSystem) {
      console.error('Connection system not available for pipeline detection');
      return null;
    }
    
    const visited = new Set();
    const executionOrder = [];
    const pipeline = {
      id: `pipeline-${Date.now()}`,
      startTileId,
      tiles: [],
      connections: [],
      hasCircularDependency: false,
      executionOrder: []
    };
    
    // Stack for tracking the current path (for circular dependency detection)
    const currentPath = new Set();
    
    const visit = (tileId) => {
      // Check for circular dependency
      if (currentPath.has(tileId)) {
        pipeline.hasCircularDependency = true;
        return;
      }
      
      // Skip already visited tiles
      if (visited.has(tileId)) return;
      
      // Mark as visited and add to current path
      visited.add(tileId);
      currentPath.add(tileId);
      
      // Get all input connections for this tile
      const inputConnections = this.connectionSystem.getInputConnections(tileId);
      
      // Add connections to pipeline
      inputConnections.forEach(conn => {
        if (!pipeline.connections.some(c => c.id === conn.id)) {
          pipeline.connections.push(conn);
        }
      });
      
      // Visit all upstream tiles first (dependencies)
      inputConnections.forEach(conn => {
        visit(conn.sourceId);
      });
      
      // Add tile to execution order after all its dependencies
      executionOrder.push(tileId);
      
      // Add tile to pipeline
      if (!pipeline.tiles.includes(tileId)) {
        pipeline.tiles.push(tileId);
      }
      
      // Remove from current path as we're done with this branch
      currentPath.delete(tileId);
    };
    
    // Start traversal from the starting tile
    visit(startTileId);
    
    // Reverse execution order to get dependencies first
    pipeline.executionOrder = executionOrder.reverse();
    
    return pipeline;
  }
  
  /**
   * Executes a complete pipeline with proper dependency handling
   * @param {Object} pipeline - Pipeline object with execution order and metadata
   * @returns {Promise<Object>} Execution result
   */
  async executePipeline(pipeline) {
    if (!pipeline) return { success: false, error: 'Invalid pipeline' };
    
    if (pipeline.hasCircularDependency) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Pipeline contains circular dependencies and cannot be executed'
      });
      return { success: false, error: 'Circular dependency detected' };
    }
    
    // Set active pipeline
    this.setState({
      activePipeline: pipeline,
      executionQueue: [...pipeline.executionOrder],
      executionInProgress: true,
      pipelineProgress: 0
    });
    
    this.render();
    
    // Highlight connections as active
    if (this.connectionSystem) {
      this.connectionSystem.highlightPipelineConnections(pipeline, 'active');
    }
    
    // Execute tiles in order
    const results = { success: true, tileResults: {} };
    let executedCount = 0;
    
    try {
      for (const tileId of pipeline.executionOrder) {
        this.setState({ currentExecutingTile: tileId });
        
        // Get the tile component
        let tileComponent = null;
        EventBus.publish('canvas:getTileById', { tileId, callback: (tile) => {
          tileComponent = tile;
        }});
        
        if (!tileComponent) {
          throw new Error(`Tile with ID ${tileId} not found`);
        }
        
        // Skip tiles that already have results
        if (tileComponent.state.results) {
          executedCount++;
          this.updatePipelineProgress(executedCount, pipeline.executionOrder.length);
          continue;
        }
        
        // Execute the tile
        const tileResult = await this.executeTile(tileComponent);
        results.tileResults[tileId] = tileResult;
        
        if (!tileResult.success) {
          results.success = false;
          results.error = `Execution failed at tile ${tileId}: ${tileResult.error}`;
          
          // Highlight connections as error
          if (this.connectionSystem) {
            this.connectionSystem.highlightPipelineConnections(pipeline, 'error');
          }
          
          break;
        }
        
        executedCount++;
        this.updatePipelineProgress(executedCount, pipeline.executionOrder.length);
      }
      
      // If pipeline completed successfully, highlight connections as completed
      if (results.success && this.connectionSystem) {
        this.connectionSystem.highlightPipelineConnections(pipeline, 'completed');
      }
    } catch (error) {
      results.success = false;
      results.error = `Pipeline execution error: ${error.message}`;
      
      // Highlight connections as error
      if (this.connectionSystem) {
        this.connectionSystem.highlightPipelineConnections(pipeline, 'error');
      }
    }
    
    // Record execution in history
    this.state.executionHistory.push({
      pipelineId: pipeline.id,
      startTime: pipeline.startTime,
      endTime: new Date(),
      success: results.success,
      tileCount: pipeline.tiles.length
    });
    
    // Reset state
    this.setState({
      activePipeline: null,
      executionQueue: [],
      executionInProgress: false,
      currentExecutingTile: null,
      pipelineProgress: 100
    });
    
    // Reset connection highlighting after a delay
    setTimeout(() => {
      if (this.connectionSystem) {
        this.connectionSystem.resetConnectionHighlighting();
      }
      this.setState({ pipelineProgress: 0 });
      this.render();
    }, 5000);
    
    return results;
  }
  
  /**
   * Executes a single workflow tile
   * @param {Object} tileComponent - The tile component to execute
   * @returns {Promise<Object>} Execution result
   */
  async executeTile(tileComponent) {
    return new Promise((resolve) => {
      // Set up one-time event listener for completion
      const completeHandler = (data) => {
        if (data.tileId === tileComponent.state.id) {
          EventBus.unsubscribe('workflow:execution:complete', completeHandler);
          EventBus.unsubscribe('workflow:execution:failed', failedHandler);
          resolve({ success: true, result: data.results });
        }
      };
      
      // Set up one-time event listener for failure
      const failedHandler = (data) => {
        if (data.tileId === tileComponent.state.id) {
          EventBus.unsubscribe('workflow:execution:complete', completeHandler);
          EventBus.unsubscribe('workflow:execution:failed', failedHandler);
          resolve({ success: false, error: data.error });
        }
      };
      
      // Subscribe to completion events
      EventBus.subscribe('workflow:execution:complete', completeHandler);
      EventBus.subscribe('workflow:execution:failed', failedHandler);
      
      // Execute the workflow
      tileComponent.executeWorkflow();
      
      // Set a timeout in case the workflow doesn't respond
      setTimeout(() => {
        EventBus.unsubscribe('workflow:execution:complete', completeHandler);
        EventBus.unsubscribe('workflow:execution:failed', failedHandler);
        resolve({ success: false, error: 'Execution timed out' });
      }, 120000); // 2 minutes timeout
    });
  }
  
  /**
   * Cancels a running pipeline execution
   */
  cancelPipeline() {
    if (!this.state.executionInProgress) return;
    
    // Publish cancel event for currently executing workflow
    if (this.state.currentExecutingTile) {
      EventBus.publish('workflow:cancel', { tileId: this.state.currentExecutingTile });
    }
    
    // Reset connection highlighting
    if (this.connectionSystem) {
      this.connectionSystem.resetConnectionHighlighting();
    }
    
    // Reset state
    this.setState({
      activePipeline: null,
      executionQueue: [],
      executionInProgress: false,
      currentExecutingTile: null,
      pipelineProgress: 0
    });
    
    this.render();
    
    // Notify user
    EventBus.publish('notification', {
      type: 'info',
      message: 'Pipeline execution cancelled'
    });
  }
  
  /**
   * Updates the pipeline progress display
   * @param {number} completed - Number of completed tiles
   * @param {number} total - Total number of tiles
   */
  updatePipelineProgress(completed, total) {
    const progress = total > 0 ? (completed / total) * 100 : 0;
    this.setState({ pipelineProgress: progress });
    this.render();
  }
  
  /**
   * Handles pipeline execution requests
   * @param {Object} data - Request data with starting tile ID
   */
  handlePipelineExecutionRequest(data) {
    if (this.state.executionInProgress) {
      EventBus.publish('notification', {
        type: 'warning',
        message: 'A pipeline is already executing. Please wait or cancel the current execution.'
      });
      return;
    }
    
    const { tileId } = data;
    
    // Detect pipeline starting from this tile
    const pipeline = this.detectPipeline(tileId);
    
    if (!pipeline) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Failed to detect pipeline. Please ensure the workflow is properly connected.'
      });
      return;
    }
    
    if (pipeline.hasCircularDependency) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Pipeline contains circular dependencies and cannot be executed'
      });
      return;
    }
    
    // Add metadata
    pipeline.startTime = new Date();
    
    // Execute the pipeline
    this.executePipeline(pipeline).then(result => {
      if (result.success) {
        EventBus.publish('notification', {
          type: 'success',
          message: 'Pipeline execution completed successfully'
        });
      } else {
        EventBus.publish('notification', {
          type: 'error',
          message: result.error || 'Pipeline execution failed'
        });
      }
    });
  }
  
  /**
   * Handles workflow execution completion
   * @param {Object} data - Completion data
   */
  handleWorkflowExecutionComplete(data) {
    // If we're not executing a pipeline, ignore
    if (!this.state.executionInProgress) return;
    
    // If this is the current executing tile, move to next
    if (this.state.currentExecutingTile === data.tileId) {
      const queue = [...this.state.executionQueue];
      queue.shift(); // Remove the completed tile
      
      this.setState({
        executionQueue: queue,
        currentExecutingTile: queue.length > 0 ? queue[0] : null
      });
    }
  }
  
  /**
   * Handles workflow execution failures
   * @param {Object} data - Failure data
   */
  handleWorkflowExecutionFailed(data) {
    // If we're not executing a pipeline, ignore
    if (!this.state.executionInProgress) return;
    
    // If this is the current executing tile, stop pipeline
    if (this.state.currentExecutingTile === data.tileId) {
      // Reset state but keep progress to show where it failed
      this.setState({
        activePipeline: null,
        executionQueue: [],
        executionInProgress: false,
        currentExecutingTile: null
      });
      
      // Don't reset progress immediately to show where it failed
      setTimeout(() => {
        this.setState({ pipelineProgress: 0 });
        this.render();
      }, 5000);
      
      // Notify user
      EventBus.publish('notification', {
        type: 'error',
        message: `Pipeline failed at step ${data.tileId}: ${data.error}`
      });
    }
  }
  
  /**
   * Handles pipeline template save request
   * @param {Object} data - Request data with starting tile ID
   */
  handlePipelineTemplateRequest(data) {
    const { tileId, templateName } = data;
    
    // Detect pipeline starting from this tile
    const pipeline = this.detectPipeline(tileId);
    
    if (!pipeline) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Failed to detect pipeline. Please ensure the workflow is properly connected.'
      });
      return;
    }
    
    if (pipeline.hasCircularDependency) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Pipeline contains circular dependencies and cannot be saved as a template'
      });
      return;
    }
    
    // If a template name was provided, save directly
    if (templateName) {
      this.savePipelineAsTemplate(pipeline, templateName);
    } else {
      // Otherwise show the save template modal
      this.setState({
        showingTemplateSaveModal: true,
        currentTemplateId: pipeline.id,
        currentTemplateName: `Pipeline Template ${this.state.pipelineTemplates.length + 1}`
      });
      this.render();
    }
  }
  
  /**
   * Handles save template button click
   */
  handleSaveTemplateClick() {
    const nameInput = this.element.querySelector('#template-name');
    const templateName = nameInput ? nameInput.value : this.state.currentTemplateName;
    
    if (!templateName || templateName.trim() === '') {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Please enter a template name'
      });
      return;
    }
    
    // Find the detected pipeline by ID
    const pipeline = this.detectPipeline(this.state.currentTemplateId);
    
    if (!pipeline) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Failed to find pipeline. Please try again.'
      });
      return;
    }
    
    // Save the pipeline as a template
    this.savePipelineAsTemplate(pipeline, templateName);
    
    // Close the modal
    this.handleSaveModalClose();
  }
  
  /**
   * Handles save modal close
   */
  handleSaveModalClose() {
    this.setState({
      showingTemplateSaveModal: false,
      currentTemplateId: null,
      currentTemplateName: ''
    });
    this.render();
  }
  
  /**
   * Saves a pipeline as a template
   * @param {Object} pipeline - Pipeline object to save
   * @param {string} templateName - Name for the template
   */
  async savePipelineAsTemplate(pipeline, templateName) {
    // Create a template object with the essential pipeline information
    const template = {
      id: `template-${Date.now()}`,
      name: templateName,
      description: `Pipeline with ${pipeline.tiles.length} tiles, created on ${new Date().toLocaleDateString()}`,
      tiles: [],
      connections: [],
      createdAt: new Date().toISOString()
    };
    
    // Get tile information
    for (const tileId of pipeline.tiles) {
      let tileData = null;
      
      // Get the tile component
      EventBus.publish('canvas:getTileById', { tileId, callback: (tile) => {
        if (tile) {
          // Get the tile data and add relative positioning
          const data = tile.getData();
          tileData = data;
        }
      }});
      
      if (tileData) {
        template.tiles.push(tileData);
      }
    }
    
    // Get connection information
    if (this.connectionSystem) {
      for (const connection of this.connectionSystem.state.connections) {
        // Only include connections that are part of this pipeline
        if (pipeline.connections.find(c => c.id === connection.id)) {
          template.connections.push(connection);
        }
      }
    }
    
    // Add to templates array
    this.state.pipelineTemplates.push(template);
    
    // Save to server
    try {
      const response = await fetch('/api/pipelines/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify(template)
      });
      
      if (!response.ok) {
        throw new Error('Failed to save pipeline template');
      }
      
      // Notify success
      EventBus.publish('notification', {
        type: 'success',
        message: `Pipeline template "${templateName}" saved successfully`
      });
      
      // Publish template saved event
      EventBus.publish('pipeline:template:saved', {
        templateId: template.id,
        templateName: template.name
      });
      
    } catch (error) {
      console.error('Error saving pipeline template:', error);
      
      // Fall back to localStorage if API fails
      try {
        const savedTemplates = JSON.parse(localStorage.getItem('pipelineTemplates') || '[]');
        savedTemplates.push(template);
        localStorage.setItem('pipelineTemplates', JSON.stringify(savedTemplates));
        
        EventBus.publish('notification', {
          type: 'warning',
          message: `Pipeline template saved locally (API error: ${error.message})`
        });
      } catch (e) {
        console.error('Failed to save template to localStorage:', e);
        EventBus.publish('notification', {
          type: 'error',
          message: 'Failed to save pipeline template'
        });
      }
    }
  }
  
  /**
   * Loads saved pipeline templates
   */
  async loadPipelineTemplates() {
    try {
      // Try to load from server first
      const response = await fetch('/api/pipelines/templates', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      if (response.ok) {
        const templates = await response.json();
        this.setState({ pipelineTemplates: templates });
        return;
      }
      
      // Fall back to localStorage if API fails
      const savedTemplates = JSON.parse(localStorage.getItem('pipelineTemplates') || '[]');
      this.setState({ pipelineTemplates: savedTemplates });
      
    } catch (error) {
      console.error('Error loading pipeline templates:', error);
      
      // Fall back to localStorage if API fails
      try {
        const savedTemplates = JSON.parse(localStorage.getItem('pipelineTemplates') || '[]');
        this.setState({ pipelineTemplates: savedTemplates });
      } catch (e) {
        console.error('Failed to load templates from localStorage:', e);
      }
    }
  }
  
  /**
   * Loads a pipeline template into the canvas
   * @param {Object} data - Request data with template ID
   */
  loadPipelineTemplate(data) {
    const { templateId } = data;
    
    // Find the template
    const template = this.state.pipelineTemplates.find(t => t.id === templateId);
    
    if (!template) {
      EventBus.publish('notification', {
        type: 'error',
        message: 'Pipeline template not found'
      });
      return;
    }
    
    // Publish event to load the template tiles and connections
    EventBus.publish('canvas:loadTemplate', {
      template,
      callback: (success) => {
        if (success) {
          EventBus.publish('notification', {
            type: 'success',
            message: `Pipeline template "${template.name}" loaded successfully`
          });
        }
      }
    });
  }
  
  /**
   * Gets all available pipeline templates
   * @returns {Array} Pipeline templates
   */
  getPipelineTemplates() {
    return this.state.pipelineTemplates;
  }
  
  /**
   * Gets execution history for pipelines
   * @returns {Array} Execution history
   */
  getExecutionHistory() {
    return this.state.executionHistory;
  }
  
  /**
   * Clears execution history
   */
  clearExecutionHistory() {
    this.setState({ executionHistory: [] });
  }
  
  /**
   * Handle requests for port type information
   * @param {Object} data - Request data
   */
  handlePortTypeRequest(data) {
    const { tileId, portName, portDirection, callback } = data;
    
    if (!tileId || !portName || !portDirection || !callback) {
      console.error('Invalid port type request:', data);
      return;
    }
    
    // Get the tile component
    let tileComponent = null;
    EventBus.publish('canvas:getTileById', { tileId, callback: (tile) => {
      tileComponent = tile;
    }});
    
    if (!tileComponent) {
      console.error(`Tile with ID ${tileId} not found for port type request`);
      callback(null);
      return;
    }
    
    // Get the port type from the tile
    if (typeof tileComponent.getPortType === 'function') {
      const portType = tileComponent.getPortType(portName, portDirection);
      callback(portType);
    } else {
      // Fallback if getPortType not implemented
      callback(null);
    }
  }
  
  /**
   * Handles get templates request
   * @param {Function} callback - Callback to receive templates
   */
  handleGetTemplates(callback) {
    if (typeof callback === 'function') {
      callback(this.state.pipelineTemplates);
    }
  }
  
  /**
   * Handles update templates request
   * @param {Object} data - Data with templates array
   */
  handleUpdateTemplates(data) {
    if (data && Array.isArray(data.templates)) {
      this.setState({ pipelineTemplates: data.templates });
    }
  }
} 