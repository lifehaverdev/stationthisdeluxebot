/**
 * Workflow Toolbar - Dynamically loads and displays available workflows
 * 
 * This module handles loading workflows from the API and displaying them
 * in a user-friendly toolbar with configurable inputs.
 */

class WorkflowToolbar {
  constructor(containerSelector = '.workflow-toolbar-container') {
    this.containerSelector = containerSelector;
    this.container = document.querySelector(containerSelector);
    this.workflows = [];
    this.currentWorkflow = null;
    this.inputDefaults = {
      // Default values for common inputs
      input_batch: 1,
      input_cfg: 7,
      input_steps: 30,
      input_strength: 0.75,
      input_width: 512,
      input_height: 512,
      input_wd14_tagger_threshold: 0.35,
      input_wd14_tagger_character_threshold: 0.85,
      input_pose_strength: 1.0,
      input_ipadapter_weight: 1.0
    };
    
    // Icons for different workflow types
    this.icons = {
      QUICKMAKE: 'fa-magic',
      QUICKI2I: 'fa-image',
      MAKE: 'fa-wand-magic-sparkles',
      INTERROGATE: 'fa-magnifying-glass',
      RMBG: 'fa-eraser',
      UPSCALE: 'fa-expand-arrows-alt',
      INPAINT: 'fa-paintbrush',
      DEFAULT: 'fa-cog'
    };
    
    // Initialize event listeners
    this.init();
  }
  
  /**
   * Initialize the toolbar
   */
  async init() {
    if (!this.container) {
      console.error(`Toolbar container '${this.containerSelector}' not found`);
      return;
    }
    
    // Create toolbar structure
    this.createToolbarStructure();
    
    // Load workflows
    await this.loadWorkflows();
    
    // Render the COMFY button
    this.renderComfyButton();
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  /**
   * Create the basic toolbar structure
   */
  createToolbarStructure() {
    this.container.innerHTML = `
      <div class="workflow-toolbar">
        <div class="workflow-buttons"></div>
        <div class="workflow-settings-panel" style="display: none;">
          <div class="panel-header">
            <h3 class="workflow-title">Workflow Settings</h3>
            <button class="close-settings-btn">×</button>
          </div>
          <div class="workflow-inputs"></div>
          <div class="workflow-actions">
            <button class="run-workflow-btn">Run</button>
            <button class="cancel-workflow-btn">Cancel</button>
          </div>
        </div>
      </div>
      
      <!-- Workflow Selection Modal -->
      <div class="workflow-modal" style="display: none;">
        <div class="workflow-modal-content">
          <div class="modal-header">
            <h3>Select Workflow</h3>
            <button class="close-modal-btn">×</button>
          </div>
          <div class="workflow-categories-container"></div>
        </div>
      </div>
    `;
    
    this.buttonsContainer = this.container.querySelector('.workflow-buttons');
    this.settingsPanel = this.container.querySelector('.workflow-settings-panel');
    this.inputsContainer = this.container.querySelector('.workflow-inputs');
    this.workflowTitle = this.container.querySelector('.workflow-title');
    this.workflowModal = this.container.querySelector('.workflow-modal');
    this.categoriesContainer = this.container.querySelector('.workflow-categories-container');
  }
  
  /**
   * Load workflows from the API
   */
  async loadWorkflows() {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      
      if (data.workflows && data.workflows.loaded > 0) {
        // Get the actual workflow data
        const workflowsResponse = await fetch('/api/internal/workflows');
        const workflowsData = await workflowsResponse.json();
        
        if (workflowsData.workflows && Array.isArray(workflowsData.workflows)) {
          this.workflows = workflowsData.workflows;
          console.log(`Loaded ${this.workflows.length} workflows`);
        }
      } else {
        console.warn('No workflows loaded from API');
      }
    } catch (error) {
      console.error('Failed to load workflows:', error);
      // Fallback: show error message in toolbar
      this.buttonsContainer.innerHTML = `
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Failed to load workflows</span>
        </div>
      `;
    }
  }
  
  /**
   * Render the COMFY button in the toolbar
   */
  renderComfyButton() {
    if (!this.workflows || this.workflows.length === 0) {
      this.buttonsContainer.innerHTML = '<div class="empty-state">No workflows available</div>';
      return;
    }
    
    // Create the COMFY button
    this.buttonsContainer.innerHTML = `
      <button class="comfy-main-btn">
        <i class="fas fa-robot"></i>
        <span>COMFY</span>
      </button>
    `;
  }
  
  /**
   * Render all workflow categories and buttons in the modal
   */
  renderWorkflowsInModal() {
    if (!this.workflows || this.workflows.length === 0) {
      this.categoriesContainer.innerHTML = '<div class="empty-state">No workflows available</div>';
      return;
    }
    
    // Group workflows by categories (using name prefix)
    const categories = this.groupWorkflowsByCategory();
    
    // Clear the categories container
    this.categoriesContainer.innerHTML = '';
    
    // Create a default COMFY category for all workflows if none exist
    if (Object.keys(categories).length === 0) {
      categories.COMFY = this.workflows;
    }
    
    // Render each category
    Object.entries(categories).forEach(([category, workflows]) => {
      // Create category section
      const categoryEl = document.createElement('div');
      categoryEl.className = 'workflow-category';
      categoryEl.innerHTML = `
        <h4>${this.formatCategoryName(category)}</h4>
        <div class="category-content"></div>
      `;
      
      this.categoriesContainer.appendChild(categoryEl);
      
      const contentEl = categoryEl.querySelector('.category-content');
      
      // Add event listener to toggle category expansion
      categoryEl.querySelector('h4').addEventListener('click', () => {
        categoryEl.classList.toggle('expanded');
      });
      
      // Create workflow buttons in this category
      workflows.forEach(workflow => {
        const button = document.createElement('button');
        button.className = 'workflow-btn';
        button.dataset.workflow = workflow.name;
        
        // Determine icon
        let icon = this.icons.DEFAULT;
        for (const [key, value] of Object.entries(this.icons)) {
          if (workflow.name.includes(key)) {
            icon = value;
            break;
          }
        }
        
        button.innerHTML = `
          <i class="fas ${icon}"></i>
          <span>${this.formatWorkflowName(workflow.name)}</span>
        `;
        
        contentEl.appendChild(button);
      });
      
      // Expand all categories by default in the modal view
      categoryEl.classList.add('expanded');
    });
  }
  
  /**
   * Group workflows by their category (using name prefix)
   */
  groupWorkflowsByCategory() {
    const categories = {};
    
    // Define priority categories
    const priorityCategories = ['MAKE', 'UPSCALE', 'RMBG', 'INTERROGATE', 'INPAINT'];
    
    this.workflows.forEach(workflow => {
      // Extract category from workflow name (e.g., "MAKE_PLUS" -> "MAKE")
      let category = null;
      
      // Check if the workflow name starts with any of the priority categories
      for (const prefix of priorityCategories) {
        if (workflow.name.startsWith(prefix)) {
          category = prefix;
          break;
        }
      }
      
      // If no matching category was found, fall back to the first part of the name
      if (!category) {
        const parts = workflow.name.split('_');
        category = parts[0];
      }
      
      // Ensure the category exists in our categories object
      if (!categories[category]) {
        categories[category] = [];
      }
      
      categories[category].push(workflow);
    });
    
    // Sort workflows within each category alphabetically by name
    Object.keys(categories).forEach(category => {
      categories[category].sort((a, b) => a.name.localeCompare(b.name));
    });
    
    return categories;
  }
  
  /**
   * Format a workflow name for display (e.g., "MAKE_PLUS" -> "Make Plus")
   */
  formatWorkflowName(name) {
    // Replace underscores with spaces
    let formatted = name.replace(/_/g, ' ');
    
    // Convert to title case
    formatted = formatted.toLowerCase().split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    
    return formatted;
  }
  
  /**
   * Format a category name for display
   */
  formatCategoryName(category) {
    return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
  }
  
  /**
   * Set up event listeners for the toolbar
   */
  setupEventListeners() {
    // COMFY button click
    const comfyBtn = this.container.querySelector('.comfy-main-btn');
    if (comfyBtn) {
      comfyBtn.addEventListener('click', () => {
        this.openWorkflowModal();
      });
    }
    
    // Close modal button
    const closeModalBtn = this.container.querySelector('.close-modal-btn');
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => {
        this.workflowModal.style.display = 'none';
      });
    }
    
    // Workflow selection in modal
    this.workflowModal.addEventListener('click', event => {
      const workflowBtn = event.target.closest('.workflow-btn');
      if (workflowBtn) {
        const workflowName = workflowBtn.dataset.workflow;
        this.workflowModal.style.display = 'none';
        this.openWorkflowSettings(workflowName);
      }
    });
    
    // Close settings panel
    const closeBtn = this.container.querySelector('.close-settings-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.settingsPanel.style.display = 'none';
      });
    }
    
    // Run workflow
    const runBtn = this.container.querySelector('.run-workflow-btn');
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        this.runCurrentWorkflow();
      });
    }
    
    // Cancel workflow
    const cancelBtn = this.container.querySelector('.cancel-workflow-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.settingsPanel.style.display = 'none';
      });
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', event => {
      if (event.target === this.workflowModal) {
        this.workflowModal.style.display = 'none';
      }
    });
  }
  
  /**
   * Open the workflow selection modal
   */
  openWorkflowModal() {
    // Render workflows in the modal
    this.renderWorkflowsInModal();
    
    // Show the modal
    this.workflowModal.style.display = 'block';
  }
  
  /**
   * Open the settings panel for a workflow
   */
  openWorkflowSettings(workflowName) {
    // Find the workflow
    const workflow = this.workflows.find(w => w.name === workflowName);
    if (!workflow) {
      console.error(`Workflow '${workflowName}' not found`);
      return;
    }
    
    this.currentWorkflow = workflow;
    
    // Update title
    this.workflowTitle.textContent = this.formatWorkflowName(workflow.name);
    
    // Clear inputs container
    this.inputsContainer.innerHTML = '';
    
    // Render inputs based on workflow inputs
    if (workflow.inputs && workflow.inputs.length > 0) {
      this.renderWorkflowInputs(workflow.inputs);
    } else {
      this.inputsContainer.innerHTML = '<div class="empty-state">This workflow has no configurable inputs</div>';
    }
    
    // Show settings panel
    this.settingsPanel.style.display = 'block';
  }
  
  /**
   * Render input fields for workflow inputs
   */
  renderWorkflowInputs(inputs) {
    // Group inputs by type
    const groupedInputs = this.groupInputsByType(inputs);
    
    // Render input groups
    Object.entries(groupedInputs).forEach(([group, groupInputs]) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'input-group';
      groupEl.innerHTML = `<h4>${this.formatGroupName(group)}</h4>`;
      
      // Render inputs in this group
      groupInputs.forEach(input => {
        const inputEl = this.createInputElement(input);
        if (inputEl) {
          groupEl.appendChild(inputEl);
        }
      });
      
      this.inputsContainer.appendChild(groupEl);
    });
  }
  
  /**
   * Group inputs by their type
   */
  groupInputsByType(inputs) {
    const groups = {
      image: [],
      text: [],
      number: [],
      advanced: []
    };
    
    inputs.forEach(input => {
      const inputName = input.replace('input_', '');
      
      if (inputName.includes('image')) {
        groups.image.push(input);
      } else if (inputName.includes('prompt') || inputName.includes('text') || inputName.includes('negative')) {
        groups.text.push(input);
      } else if (
        inputName.includes('steps') || 
        inputName.includes('cfg') || 
        inputName.includes('seed') || 
        inputName.includes('width') || 
        inputName.includes('height') || 
        inputName.includes('batch')
      ) {
        groups.number.push(input);
      } else {
        groups.advanced.push(input);
      }
    });
    
    // Remove empty groups
    Object.keys(groups).forEach(key => {
      if (groups[key].length === 0) {
        delete groups[key];
      }
    });
    
    return groups;
  }
  
  /**
   * Format a group name for display
   */
  formatGroupName(group) {
    const names = {
      image: 'Images',
      text: 'Text & Prompts',
      number: 'Basic Settings',
      advanced: 'Advanced Settings'
    };
    
    return names[group] || group.charAt(0).toUpperCase() + group.slice(1);
  }
  
  /**
   * Create an input element for a workflow input
   */
  createInputElement(input) {
    const inputName = input.replace('input_', '');
    const label = this.formatInputName(inputName);
    const defaultValue = this.inputDefaults[input] || '';
    
    const container = document.createElement('div');
    container.className = 'input-container';
    
    // Determine input type
    if (inputName.includes('image')) {
      // Image upload input
      container.innerHTML = `
        <label>${label}</label>
        <div class="image-upload">
          <input type="file" id="${input}" accept="image/*">
          <div class="upload-placeholder">
            <i class="fas fa-upload"></i>
            <span>Click to upload</span>
          </div>
          <div class="image-preview" style="display: none;">
            <img src="#" alt="Preview">
            <button class="remove-image-btn"><i class="fas fa-times"></i></button>
          </div>
        </div>
      `;
      
      // Add event listeners for image upload
      setTimeout(() => {
        const fileInput = container.querySelector('input[type="file"]');
        const placeholder = container.querySelector('.upload-placeholder');
        const preview = container.querySelector('.image-preview');
        const previewImg = preview.querySelector('img');
        const removeBtn = container.querySelector('.remove-image-btn');
        
        fileInput.addEventListener('change', () => {
          if (fileInput.files && fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = e => {
              previewImg.src = e.target.result;
              placeholder.style.display = 'none';
              preview.style.display = 'block';
            };
            reader.readAsDataURL(fileInput.files[0]);
          }
        });
        
        removeBtn.addEventListener('click', () => {
          fileInput.value = '';
          preview.style.display = 'none';
          placeholder.style.display = 'flex';
        });
      }, 0);
      
    } else if (inputName.includes('prompt') || inputName.includes('text') || inputName.includes('negative')) {
      // Text area for prompts
      container.innerHTML = `
        <label>${label}</label>
        <textarea id="${input}" rows="3" placeholder="Enter ${label.toLowerCase()}">${defaultValue}</textarea>
      `;
      
    } else if (inputName.includes('seed')) {
      // Number input for seed with random option
      container.innerHTML = `
        <label>${label}</label>
        <div class="seed-input">
          <input type="number" id="${input}" value="${defaultValue || -1}" min="-1" step="1">
          <button class="random-seed-btn" title="Generate random seed"><i class="fas fa-dice"></i></button>
        </div>
        <small>Use -1 for random seed</small>
      `;
      
      // Add event listener for random seed button
      setTimeout(() => {
        const randomBtn = container.querySelector('.random-seed-btn');
        const seedInput = container.querySelector('input[type="number"]');
        
        randomBtn.addEventListener('click', () => {
          seedInput.value = Math.floor(Math.random() * 1000000000);
        });
      }, 0);
      
    } else if (
      inputName.includes('width') || 
      inputName.includes('height') || 
      inputName.includes('steps') || 
      inputName.includes('batch')
    ) {
      // Simple number input with min/max
      let min = 1;
      let max = 2048;
      let step = 1;
      
      if (inputName.includes('width') || inputName.includes('height')) {
        min = 64;
        max = 2048;
        step = 8;
      } else if (inputName.includes('steps')) {
        min = 1;
        max = 150;
      } else if (inputName.includes('batch')) {
        min = 1;
        max = 10;
      }
      
      container.innerHTML = `
        <label>${label}</label>
        <input type="number" id="${input}" value="${defaultValue}" min="${min}" max="${max}" step="${step}">
      `;
      
    } else if (inputName.includes('strength') || inputName.includes('weight') || inputName.includes('threshold')) {
      // Slider for strength/weight values
      let min = 0;
      let max = 1;
      let step = 0.01;
      
      container.innerHTML = `
        <label>${label}: <span class="slider-value">${defaultValue}</span></label>
        <input type="range" id="${input}" value="${defaultValue}" min="${min}" max="${max}" step="${step}">
      `;
      
      // Add event listener for slider
      setTimeout(() => {
        const slider = container.querySelector('input[type="range"]');
        const valueDisplay = container.querySelector('.slider-value');
        
        slider.addEventListener('input', () => {
          valueDisplay.textContent = slider.value;
        });
      }, 0);
      
    } else if (inputName.includes('checkpoint')) {
      // Select input for checkpoints
      container.innerHTML = `
        <label>${label}</label>
        <select id="${input}">
          <option value="sd_xl_base_1.0.safetensors">SD XL Base 1.0</option>
          <option value="sdxl_lightning_4step_lora.safetensors">SDXL Lightning (4 step)</option>
          <option value="dream_shaper_xl_v2.safetensors">Dream Shaper XL v2</option>
          <option value="zavychromaxl_v60.safetensors">ZavyChroma XL v6.0</option>
        </select>
      `;
    } else {
      // Default to text input for other types
      container.innerHTML = `
        <label>${label}</label>
        <input type="text" id="${input}" value="${defaultValue}">
      `;
    }
    
    return container;
  }
  
  /**
   * Format an input name for display
   */
  formatInputName(name) {
    // Convert input_seed to "Seed"
    return name.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  /**
   * Run the currently selected workflow
   */
  async runCurrentWorkflow() {
    if (!this.currentWorkflow) {
      console.error('No workflow selected');
      return;
    }
    
    // Collect input values
    const inputs = {};
    
    this.currentWorkflow.inputs.forEach(input => {
      const inputEl = document.getElementById(input);
      if (!inputEl) return;
      
      if (inputEl.type === 'file') {
        // Handle file inputs separately
        if (inputEl.files && inputEl.files[0]) {
          inputs[input] = {
            type: 'file',
            file: inputEl.files[0]
          };
        }
      } else {
        // Regular inputs
        inputs[input] = inputEl.value;
      }
    });
    
    console.log('Running workflow:', this.currentWorkflow.name, inputs);
    
    // Send the workflow execution request
    try {
      // First, upload any images
      const formData = new FormData();
      let hasFiles = false;
      
      Object.entries(inputs).forEach(([key, value]) => {
        if (value && typeof value === 'object' && value.type === 'file') {
          formData.append(key, value.file);
          hasFiles = true;
          delete inputs[key]; // Remove from regular inputs
        }
      });
      
      // If we have files, upload them first
      if (hasFiles) {
        const uploadResponse = await fetch('/api/internal/upload', {
          method: 'POST',
          body: formData
        });
        
        if (!uploadResponse.ok) {
          throw new Error('Failed to upload files');
        }
        
        const uploadResult = await uploadResponse.json();
        
        // Add file URLs to inputs
        Object.entries(uploadResult.files || {}).forEach(([key, url]) => {
          inputs[key] = url;
        });
      }
      
      // Now execute the workflow
      const response = await fetch(`/api/internal/workflows/execute/${this.currentWorkflow.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs })
      });
      
      if (!response.ok) {
        throw new Error('Failed to execute workflow');
      }
      
      const result = await response.json();
      
      // Hide settings panel
      this.settingsPanel.style.display = 'none';
      
      // Trigger an event that the main UI can listen for
      const event = new CustomEvent('workflowCompleted', { 
        detail: { 
          workflow: this.currentWorkflow.name,
          result 
        } 
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      console.error('Error executing workflow:', error);
      alert('Failed to execute workflow: ' + error.message);
    }
  }
}

// Initialize the toolbar when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.workflowToolbar = new WorkflowToolbar();
}); 