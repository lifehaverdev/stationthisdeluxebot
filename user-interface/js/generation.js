/**
 * ComfyDeploy Workflow Integration
 * Handles interaction with the ComfyDeploy service
 */

class GenerationManager {
    constructor() {
      this.workflows = [];
      this.activeJobs = new Map();
      this.pollingIntervals = new Map();
    }
  
    /**
     * Initialize the Generation Manager
     */
    async initialize() {
      try {
        // Fetch available workflows
        await this.refreshWorkflows();
        
        // Set up UI components
        this.setupUIComponents();
        
        console.log('Generation Manager initialized');
      } catch (error) {
        console.error('Failed to initialize Generation Manager:', error);
      }
    }
  
    /**
     * Fetch available workflows from the server
     */
    async refreshWorkflows() {
      try {
        const response = await fetch('/api/generation/workflows');
        const data = await response.json();
        
        if (data.success && Array.isArray(data.workflows)) {
          this.workflows = data.workflows;
          this.updateWorkflowSelector();
        } else {
          console.error('Invalid workflow data received:', data);
        }
      } catch (error) {
        console.error('Failed to fetch workflows:', error);
      }
    }
  
    /**
     * Update the workflow selector with available workflows
     */
    updateWorkflowSelector() {
      const selector = document.getElementById('workflow-selector');
      if (!selector) return;
      
      // Clear existing options
      selector.innerHTML = '';
      
      // Add default option
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select a workflow...';
      selector.appendChild(defaultOption);
      
      // Add workflow options
      this.workflows.forEach(workflow => {
        const option = document.createElement('option');
        option.value = workflow.id;
        option.textContent = workflow.name;
        selector.appendChild(option);
      });
    }
  
    /**
     * Set up UI components and event listeners
     */
    setupUIComponents() {
      // Find generation form
      const generationForm = document.getElementById('generation-form');
      if (!generationForm) {
        console.warn('Generation form not found in the DOM');
        return;
      }
      
      // Add submit handler
      generationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await this.handleGenerationSubmit(generationForm);
      });
      
      // Set up workflow selector change handler
      const workflowSelector = document.getElementById('workflow-selector');
      if (workflowSelector) {
        workflowSelector.addEventListener('change', () => {
          this.handleWorkflowChange(workflowSelector.value);
        });
      }
      
      // Set up refresh button
      const refreshButton = document.getElementById('refresh-workflows');
      if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
          await this.refreshWorkflows();
        });
      }
    }
  
    /**
     * Handle generation form submission
     */
    async handleGenerationSubmit(form) {
      try {
        // Get form data
        const formData = new FormData(form);
        const workflowId = formData.get('workflow');
        
        if (!workflowId) {
          alert('Please select a workflow');
          return;
        }
        
        // Get parameters from form
        const parameters = {};
        
        // Collect all parameters from the form
        formData.forEach((value, key) => {
          if (key !== 'workflow') {
            parameters[key] = value;
          }
        });
        
        // Show loading state
        this.setGenerationLoading(true);
        
        // Submit job
        const response = await fetch('/api/generation/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            workflowId,
            parameters
          })
        });
        
        const data = await response.json();
        
        if (data.success && data.jobId) {
          // Start polling for status
          this.trackGenerationJob(data.jobId);
        } else {
          alert('Failed to start generation: ' + (data.error || 'Unknown error'));
          this.setGenerationLoading(false);
        }
      } catch (error) {
        console.error('Generation submission error:', error);
        alert('Failed to submit generation job: ' + error.message);
        this.setGenerationLoading(false);
      }
    }
  
    /**
     * Handle workflow selection change
     */
    handleWorkflowChange(workflowId) {
      const parametersContainer = document.getElementById('workflow-parameters');
      if (!parametersContainer) return;
      
      // Clear existing parameters
      parametersContainer.innerHTML = '';
      
      if (!workflowId) return;
      
      // Find the selected workflow
      const workflow = this.workflows.find(w => w.id === workflowId);
      if (!workflow || !workflow.parameters) return;
      
      // Create parameter inputs
      Object.entries(workflow.parameters).forEach(([key, param]) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'parameter-group';
        
        const legend = document.createElement('legend');
        legend.textContent = param.label || key;
        fieldset.appendChild(legend);
        
        // Create input based on parameter type
        let input;
        switch (param.type) {
          case 'text':
          case 'string':
            input = document.createElement('input');
            input.type = 'text';
            input.name = key;
            input.value = param.default || '';
            input.placeholder = param.placeholder || '';
            break;
          case 'number':
            input = document.createElement('input');
            input.type = 'number';
            input.name = key;
            input.value = param.default || 0;
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;
            break;
          case 'boolean':
            input = document.createElement('input');
            input.type = 'checkbox';
            input.name = key;
            input.checked = param.default || false;
            break;
          case 'select':
            input = document.createElement('select');
            input.name = key;
            if (param.options) {
              param.options.forEach(option => {
                const optionEl = document.createElement('option');
                optionEl.value = option.value;
                optionEl.textContent = option.label || option.value;
                if (option.value === param.default) {
                  optionEl.selected = true;
                }
                input.appendChild(optionEl);
              });
            }
            break;
          case 'textarea':
            input = document.createElement('textarea');
            input.name = key;
            input.value = param.default || '';
            input.placeholder = param.placeholder || '';
            input.rows = param.rows || 4;
            break;
          default:
            input = document.createElement('input');
            input.type = 'text';
            input.name = key;
            input.value = param.default || '';
        }
        
        input.className = 'parameter-input';
        if (param.required) {
          input.required = true;
        }
        
        fieldset.appendChild(input);
        
        // Add description if provided
        if (param.description) {
          const description = document.createElement('p');
          description.className = 'parameter-description';
          description.textContent = param.description;
          fieldset.appendChild(description);
        }
        
        parametersContainer.appendChild(fieldset);
      });
    }
  
    /**
     * Set loading state for generation form
     */
    setGenerationLoading(isLoading) {
      const generateButton = document.querySelector('#generation-form button[type="submit"]');
      const form = document.getElementById('generation-form');
      
      if (generateButton) {
        generateButton.disabled = isLoading;
        generateButton.textContent = isLoading ? 'Generating...' : 'Generate';
      }
      
      if (form) {
        form.classList.toggle('loading', isLoading);
      }
    }
  
    /**
     * Track a generation job and update UI
     */
    trackGenerationJob(jobId) {
      // Create job status element if it doesn't exist
      let jobStatusContainer = document.getElementById('job-status-container');
      if (!jobStatusContainer) {
        jobStatusContainer = document.createElement('div');
        jobStatusContainer.id = 'job-status-container';
        document.querySelector('.main-content').appendChild(jobStatusContainer);
      }
      
      // Create job status element
      const jobStatusEl = document.createElement('div');
      jobStatusEl.className = 'job-status';
      jobStatusEl.dataset.jobId = jobId;
      jobStatusEl.innerHTML = `
        <h3>Job ${jobId}</h3>
        <p class="status">Status: <span class="status-value">Pending</span></p>
        <div class="progress"><div class="progress-bar"></div></div>
        <div class="result-container"></div>
      `;
      
      jobStatusContainer.prepend(jobStatusEl);
      
      // Add to active jobs
      this.activeJobs.set(jobId, {
        element: jobStatusEl,
        status: 'pending',
        progress: 0
      });
      
      // Start polling for job status
      this.startPollingJobStatus(jobId);
    }
  
    /**
     * Start polling for job status
     */
    startPollingJobStatus(jobId) {
      // Clear existing interval if any
      if (this.pollingIntervals.has(jobId)) {
        clearInterval(this.pollingIntervals.get(jobId));
      }
      
      // Start new polling interval
      const interval = setInterval(() => this.pollJobStatus(jobId), 2000);
      this.pollingIntervals.set(jobId, interval);
      
      // Poll immediately
      this.pollJobStatus(jobId);
    }
  
    /**
     * Poll for job status
     */
    async pollJobStatus(jobId) {
      try {
        // Get job from active jobs
        const job = this.activeJobs.get(jobId);
        if (!job) return;
        
        // Get job status
        const response = await fetch(`/api/generation/status/${jobId}`);
        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error || 'Failed to get job status');
        }
        
        // Update job status
        this.updateJobStatus(jobId, data);
        
        // Stop polling if job is done
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(this.pollingIntervals.get(jobId));
          this.pollingIntervals.delete(jobId);
          
          // Clear loading state
          this.setGenerationLoading(false);
        }
      } catch (error) {
        console.error(`Error polling job status for ${jobId}:`, error);
      }
    }
  
    /**
     * Update job status in UI
     */
    updateJobStatus(jobId, data) {
      const job = this.activeJobs.get(jobId);
      if (!job) return;
      
      // Update job object
      job.status = data.status;
      job.progress = data.progress || 0;
      
      // Update status element
      const statusEl = job.element.querySelector('.status-value');
      if (statusEl) {
        statusEl.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
      }
      
      // Update progress bar
      const progressBar = job.element.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = `${job.progress}%`;
      }
      
      // If job is completed, show results
      if (data.status === 'completed' && data.output) {
        this.displayJobResult(jobId, data.output);
      }
      
      // If job failed, show error
      if (data.status === 'failed') {
        this.displayJobError(jobId, data.error || 'Unknown error');
      }
    }
  
    /**
     * Display job result in UI
     */
    displayJobResult(jobId, output) {
      const job = this.activeJobs.get(jobId);
      if (!job) return;
      
      const resultContainer = job.element.querySelector('.result-container');
      if (!resultContainer) return;
      
      // Clear result container
      resultContainer.innerHTML = '';
      
      // Create image element if output is an image
      if (output.imageUrl) {
        const img = document.createElement('img');
        img.src = output.imageUrl;
        img.alt = 'Generated image';
        img.className = 'result-image';
        resultContainer.appendChild(img);
        
        // Add download button
        const downloadBtn = document.createElement('a');
        downloadBtn.href = output.imageUrl;
        downloadBtn.download = `generation-${jobId}.png`;
        downloadBtn.className = 'download-button';
        downloadBtn.textContent = 'Download';
        resultContainer.appendChild(downloadBtn);
      }
      
      // Handle other output types
      if (output.text) {
        const textEl = document.createElement('pre');
        textEl.className = 'result-text';
        textEl.textContent = output.text;
        resultContainer.appendChild(textEl);
      }
    }
  
    /**
     * Display job error in UI
     */
    displayJobError(jobId, error) {
      const job = this.activeJobs.get(jobId);
      if (!job) return;
      
      const resultContainer = job.element.querySelector('.result-container');
      if (!resultContainer) return;
      
      // Display error
      resultContainer.innerHTML = `
        <div class="error-message">
          <h4>Error</h4>
          <p>${error}</p>
        </div>
      `;
    }
}

// Initialize the generation manager on page load
document.addEventListener('DOMContentLoaded', () => {
  const generationManager = new GenerationManager();
  generationManager.initialize();
  
  // Expose to window for debugging
  window.generationManager = generationManager;
});