// WorkflowConfigPanel for the StationThis web interface
// Provides parameter configuration UI for workflow tiles

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';

export class WorkflowConfigPanel extends Component {
  constructor(parentElement, options = {}) {
    super(parentElement);
    
    this.state = {
      isVisible: false,
      workflowType: options.workflowType || null,
      tileId: options.tileId || null,
      parameters: options.parameters || {},
      workflowConfig: null,
      loading: true,
      error: null,
      pointCost: 0
    };
    
    // Bind methods
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
    this.loadWorkflowConfig = this.loadWorkflowConfig.bind(this);
    this.calculateCost = this.calculateCost.bind(this);
    
    // Function to call when parameters are saved
    this.onSaveCallback = options.onSave || null;
    
    // Initialize the component
    this.init();
  }
  
  template() {
    if (!this.state.isVisible) {
      return '<div class="workflow-config-panel" style="display: none;"></div>';
    }
    
    if (this.state.loading) {
      return `
        <div class="workflow-config-panel">
          <div class="panel-header">
            <h3>Loading workflow configuration...</h3>
            <button class="btn-close">×</button>
          </div>
          <div class="panel-content loading">
            <div class="spinner"></div>
          </div>
        </div>
      `;
    }
    
    if (this.state.error) {
      return `
        <div class="workflow-config-panel">
          <div class="panel-header">
            <h3>Error Loading Configuration</h3>
            <button class="btn-close">×</button>
          </div>
          <div class="panel-content error">
            <p>${this.state.error}</p>
            <button class="btn-retry">Retry</button>
          </div>
        </div>
      `;
    }
    
    // Render parameter form based on workflow type
    const paramFields = this.renderParameterFields();
    
    return `
      <div class="workflow-config-panel">
        <div class="panel-header">
          <h3>Configure ${this.state.workflowConfig?.name || this.state.workflowType}</h3>
          <button class="btn-close">×</button>
        </div>
        <div class="panel-content">
          <form id="workflow-config-form">
            ${paramFields}
            <div class="cost-display">
              <span>Estimated Cost: <strong>${this.state.pointCost} points</strong></span>
            </div>
            <div class="form-actions">
              <button type="button" class="btn-cancel">Cancel</button>
              <button type="submit" class="btn-save">Save Configuration</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
  
  renderParameterFields() {
    if (!this.state.workflowConfig || !this.state.workflowConfig.parameters) {
      return '<p>No parameters available for this workflow.</p>';
    }
    
    return this.state.workflowConfig.parameters.map(param => {
      const value = this.state.parameters[param.name] !== undefined ? 
                    this.state.parameters[param.name] : 
                    param.default;
      
      switch (param.type) {
        case 'text':
        case 'string':
          return `
            <div class="form-group">
              <label for="param-${param.name}">${param.label || param.name}</label>
              <input 
                type="text" 
                id="param-${param.name}" 
                name="${param.name}" 
                value="${value || ''}" 
                placeholder="${param.placeholder || ''}"
                ${param.required ? 'required' : ''}
              />
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
          
        case 'number':
          return `
            <div class="form-group">
              <label for="param-${param.name}">${param.label || param.name}</label>
              <input 
                type="number" 
                id="param-${param.name}" 
                name="${param.name}" 
                value="${value !== undefined ? value : ''}" 
                min="${param.min !== undefined ? param.min : ''}"
                max="${param.max !== undefined ? param.max : ''}"
                step="${param.step || 1}"
                ${param.required ? 'required' : ''}
              />
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
          
        case 'select':
          const options = param.options.map(opt => {
            const optValue = typeof opt === 'object' ? opt.value : opt;
            const optLabel = typeof opt === 'object' ? opt.label : opt;
            const selected = value === optValue ? 'selected' : '';
            return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
          }).join('');
          
          return `
            <div class="form-group">
              <label for="param-${param.name}">${param.label || param.name}</label>
              <select 
                id="param-${param.name}" 
                name="${param.name}"
                ${param.required ? 'required' : ''}
              >
                ${options}
              </select>
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
          
        case 'checkbox':
          return `
            <div class="form-group checkbox">
              <input 
                type="checkbox" 
                id="param-${param.name}" 
                name="${param.name}" 
                ${value ? 'checked' : ''}
              />
              <label for="param-${param.name}">${param.label || param.name}</label>
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
          
        case 'textarea':
          return `
            <div class="form-group">
              <label for="param-${param.name}">${param.label || param.name}</label>
              <textarea 
                id="param-${param.name}" 
                name="${param.name}" 
                rows="${param.rows || 4}"
                placeholder="${param.placeholder || ''}"
                ${param.required ? 'required' : ''}
              >${value || ''}</textarea>
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
          
        default:
          return `
            <div class="form-group">
              <label for="param-${param.name}">${param.label || param.name}</label>
              <input 
                type="text" 
                id="param-${param.name}" 
                name="${param.name}" 
                value="${value || ''}"
                ${param.required ? 'required' : ''}
              />
              ${param.description ? `<p class="param-description">${param.description}</p>` : ''}
            </div>
          `;
      }
    }).join('');
  }
  
  init() {
    this.appendToParent();
    
    // Subscribe to workflow configuration events
    EventBus.subscribe('workflow:configure', this.show);
    
    // Add event listeners for buttons
    this.addEventListeners();
  }
  
  addEventListeners() {
    // These will be added when the panel is shown
    if (this.state.isVisible) {
      const closeBtn = this.element.querySelector('.btn-close');
      const cancelBtn = this.element.querySelector('.btn-cancel');
      const saveBtn = this.element.querySelector('.btn-save');
      const form = this.element.querySelector('#workflow-config-form');
      const retryBtn = this.element.querySelector('.btn-retry');
      
      if (closeBtn) {
        closeBtn.addEventListener('click', this.handleCancel);
      }
      
      if (cancelBtn) {
        cancelBtn.addEventListener('click', this.handleCancel);
      }
      
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleSubmit();
        });
        
        // Add change listeners to all input fields
        form.querySelectorAll('input, select, textarea').forEach(input => {
          input.addEventListener('change', this.handleInputChange);
          input.addEventListener('input', () => {
            // Debounce the cost calculation for text inputs
            clearTimeout(this.costDebounce);
            this.costDebounce = setTimeout(() => {
              this.calculateCost();
            }, 500);
          });
        });
      }
      
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.setState({ loading: true, error: null });
          this.render();
          this.loadWorkflowConfig();
        });
      }
    }
  }
  
  show(data) {
    // Show the configuration panel with the specified workflow type
    this.setState({
      isVisible: true,
      workflowType: data.workflowType,
      tileId: data.tileId,
      parameters: data.currentParameters || {},
      loading: true,
      error: null
    });
    
    // Store the callback function
    this.onSaveCallback = data.onSave || null;
    
    this.render();
    this.addEventListeners();
    
    // Load the workflow configuration
    this.loadWorkflowConfig();
  }
  
  hide() {
    this.setState({ isVisible: false });
    this.render();
  }
  
  async loadWorkflowConfig() {
    if (!this.state.workflowType) {
      this.setState({
        loading: false,
        error: 'No workflow type specified'
      });
      this.render();
      this.addEventListeners();
      return;
    }
    
    try {
      // Fetch workflow configuration from API
      const response = await fetch(`/api/workflows/config/${this.state.workflowType}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load workflow configuration: ${response.statusText}`);
      }
      
      const config = await response.json();
      
      this.setState({
        loading: false,
        workflowConfig: config
      });
      
      // Calculate initial cost
      this.calculateCost();
      
      this.render();
      this.addEventListeners();
    } catch (error) {
      console.error('Error loading workflow configuration:', error);
      
      this.setState({
        loading: false,
        error: error.message || 'Failed to load workflow configuration'
      });
      
      this.render();
      this.addEventListeners();
    }
  }
  
  handleInputChange(e) {
    const { name, type, value, checked } = e.target;
    
    // Update the parameter value
    const newValue = type === 'checkbox' ? checked : value;
    
    // Update the parameters state
    this.setState({
      parameters: {
        ...this.state.parameters,
        [name]: newValue
      }
    });
    
    // Calculate cost based on the updated parameters
    this.calculateCost();
  }
  
  async calculateCost() {
    if (!this.state.workflowType) return;
    
    try {
      // Call API to calculate cost
      const response = await fetch('/api/workflows/calculate-cost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workflowType: this.state.workflowType,
          parameters: this.state.parameters
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to calculate cost');
      }
      
      const result = await response.json();
      
      this.setState({ pointCost: result.cost });
      
      // Update the cost display without re-rendering the whole component
      const costDisplay = this.element.querySelector('.cost-display strong');
      if (costDisplay) {
        costDisplay.textContent = `${result.cost} points`;
      }
    } catch (error) {
      console.error('Error calculating cost:', error);
      
      // Use fallback cost calculation
      const baseCost = this.state.workflowConfig?.baseCost || 10;
      this.setState({ pointCost: baseCost });
      
      // Update the cost display without re-rendering the whole component
      const costDisplay = this.element.querySelector('.cost-display strong');
      if (costDisplay) {
        costDisplay.textContent = `${baseCost} points (estimate)`;
      }
    }
  }
  
  handleSubmit() {
    if (this.onSaveCallback) {
      // Call the onSave callback with the updated parameters
      this.onSaveCallback(this.state.parameters);
    }
    
    // Publish event for parameter update
    EventBus.publish('workflow:parameters:saved', {
      tileId: this.state.tileId,
      workflowType: this.state.workflowType,
      parameters: this.state.parameters,
      pointCost: this.state.pointCost
    });
    
    // Hide the panel
    this.hide();
  }
  
  handleCancel() {
    // Hide the panel without saving
    this.hide();
    
    // Publish cancel event
    EventBus.publish('workflow:configure:cancelled', {
      tileId: this.state.tileId
    });
  }
  
  destroy() {
    // Unsubscribe from events
    EventBus.unsubscribe('workflow:configure', this.show);
    
    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
} 