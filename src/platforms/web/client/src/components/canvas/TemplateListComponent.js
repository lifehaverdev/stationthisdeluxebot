/**
 * Template List Component for StationThis web interface
 * Displays and manages pipeline templates
 */

import { Component } from '../common/Component.js';
import { EventBus } from '../../stores/EventBus.js';

export class TemplateListComponent extends Component {
  constructor(parentElement) {
    super(parentElement);
    
    this.state = {
      templates: [],
      isVisible: false,
      isLoading: false,
      error: null
    };
    
    // Bind methods
    this.loadTemplates = this.loadTemplates.bind(this);
    this.handleToggle = this.handleToggle.bind(this);
    this.handleTemplateClick = this.handleTemplateClick.bind(this);
    this.handleDeleteTemplate = this.handleDeleteTemplate.bind(this);
    this.handleTemplateAdded = this.handleTemplateAdded.bind(this);
    
    // Initialize the template list
    this.init();
  }
  
  template() {
    return `
      <div class="template-list-component ${this.state.isVisible ? 'visible' : ''}">
        <div class="template-list-header">
          <h3>Pipeline Templates</h3>
          <button class="btn-close-templates">&times;</button>
        </div>
        
        ${this.state.isLoading ? `
          <div class="template-list-loading">
            <div class="loading-spinner"></div>
            <p>Loading templates...</p>
          </div>
        ` : this.state.error ? `
          <div class="template-list-error">
            <p>${this.state.error}</p>
            <button class="btn-retry">Retry</button>
          </div>
        ` : this.state.templates.length === 0 ? `
          <div class="template-list-empty">
            <p>No templates found.</p>
            <p>Save a pipeline as a template to get started!</p>
          </div>
        ` : `
          <div class="template-list-content">
            <ul class="template-items">
              ${this.state.templates.map(template => `
                <li class="template-item" data-id="${template.id}">
                  <div class="template-item-info">
                    <span class="template-name">${template.name}</span>
                    <span class="template-date">${new Date(template.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div class="template-item-actions">
                    <button class="btn-load-template" data-id="${template.id}" title="Load Template">Load</button>
                    <button class="btn-delete-template" data-id="${template.id}" title="Delete Template">Delete</button>
                  </div>
                </li>
              `).join('')}
            </ul>
          </div>
        `}
      </div>
    `;
  }
  
  init() {
    this.appendToParent();
    
    // Subscribe to events
    EventBus.subscribe('template:toggle', this.handleToggle);
    EventBus.subscribe('pipeline:template:saved', this.handleTemplateAdded);
    
    // Add event listeners
    this.addEventListeners();
    
    // Load templates on init if visible
    if (this.state.isVisible) {
      this.loadTemplates();
    }
  }
  
  addEventListeners() {
    // Close button
    const closeBtn = this.element.querySelector('.btn-close-templates');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
    
    // Retry button
    const retryBtn = this.element.querySelector('.btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', this.loadTemplates);
    }
    
    // Template load buttons
    const loadBtns = this.element.querySelectorAll('.btn-load-template');
    if (loadBtns) {
      loadBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const templateId = btn.getAttribute('data-id');
          this.handleTemplateClick(templateId);
        });
      });
    }
    
    // Template delete buttons
    const deleteBtns = this.element.querySelectorAll('.btn-delete-template');
    if (deleteBtns) {
      deleteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const templateId = btn.getAttribute('data-id');
          this.handleDeleteTemplate(templateId);
        });
      });
    }
  }
  
  /**
   * Load templates from the API or PipelineExecutionSystem
   */
  async loadTemplates() {
    this.setState({ isLoading: true, error: null });
    
    try {
      // First try to get templates from the PipelineExecutionSystem
      let templates = [];
      
      EventBus.publish('pipeline:getTemplates', (pipelineTemplates) => {
        if (pipelineTemplates && pipelineTemplates.length > 0) {
          templates = pipelineTemplates;
        }
      });
      
      // If no templates from the PipelineExecutionSystem, try the API
      if (templates.length === 0) {
        try {
          const authToken = localStorage.getItem('authToken');
          
          if (authToken) {
            const response = await fetch('/api/pipelines/templates', {
              headers: {
                'Authorization': `Bearer ${authToken}`
              }
            });
            
            if (response.ok) {
              templates = await response.json();
              
              // Update templates in the PipelineExecutionSystem
              EventBus.publish('pipeline:updateTemplates', { templates });
            }
          }
        } catch (error) {
          console.warn('Failed to fetch templates from API:', error);
          // Continue with local templates
        }
      }
      
      this.setState({ templates, isLoading: false });
      
    } catch (error) {
      console.error('Error loading templates:', error);
      this.setState({ 
        isLoading: false, 
        error: 'Failed to load templates. Please try again.' 
      });
    }
    
    this.render();
    this.addEventListeners();
  }
  
  /**
   * Handle template visibility toggle
   */
  handleToggle(data = {}) {
    const isVisible = data.show !== undefined ? data.show : !this.state.isVisible;
    
    this.setState({ isVisible });
    
    if (isVisible && this.state.templates.length === 0) {
      this.loadTemplates();
    }
    
    this.render();
    this.addEventListeners();
  }
  
  /**
   * Show the template list
   */
  show() {
    this.handleToggle({ show: true });
  }
  
  /**
   * Hide the template list
   */
  hide() {
    this.handleToggle({ show: false });
  }
  
  /**
   * Handle template click/load
   * @param {string} templateId - ID of the template to load
   */
  handleTemplateClick(templateId) {
    // Find the template
    const template = this.state.templates.find(t => t.id === templateId);
    
    if (!template) {
      console.error('Template not found:', templateId);
      return;
    }
    
    // Load the template through the PipelineExecutionSystem
    EventBus.publish('pipeline:loadTemplate', { templateId });
    
    // Close the template list
    this.hide();
  }
  
  /**
   * Handle template deletion
   * @param {string} templateId - ID of the template to delete
   */
  async handleDeleteTemplate(templateId) {
    try {
      // Confirm deletion
      if (!confirm('Are you sure you want to delete this template?')) {
        return;
      }
      
      // Remove from local state
      const updatedTemplates = this.state.templates.filter(t => t.id !== templateId);
      this.setState({ templates: updatedTemplates });
      
      // Update UI
      this.render();
      this.addEventListeners();
      
      // Try to delete from API
      try {
        const authToken = localStorage.getItem('authToken');
        
        if (authToken) {
          const response = await fetch(`/api/pipelines/templates/${templateId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          
          if (!response.ok) {
            throw new Error('Failed to delete template from server');
          }
        }
      } catch (error) {
        console.warn('Failed to delete template from API:', error);
        
        // Update local storage as fallback
        try {
          const savedTemplates = JSON.parse(localStorage.getItem('pipelineTemplates') || '[]');
          const filteredTemplates = savedTemplates.filter(t => t.id !== templateId);
          localStorage.setItem('pipelineTemplates', JSON.stringify(filteredTemplates));
        } catch (err) {
          console.error('Failed to update templates in localStorage:', err);
        }
      }
      
      // Update templates in the PipelineExecutionSystem
      EventBus.publish('pipeline:updateTemplates', { templates: updatedTemplates });
      
      // Show notification
      EventBus.publish('notification', {
        type: 'success',
        message: 'Template deleted successfully'
      });
      
    } catch (error) {
      console.error('Error deleting template:', error);
      
      // Show error notification
      EventBus.publish('notification', {
        type: 'error',
        message: 'Failed to delete template'
      });
      
      // Reload templates to ensure consistency
      this.loadTemplates();
    }
  }
  
  /**
   * Handle new template added event
   */
  handleTemplateAdded(data) {
    // Reload templates
    this.loadTemplates();
  }
} 