/**
 * Web Platform Routes
 * 
 * Initializes all routes for the web platform
 */

const authRoutes = require('./authRoutes');
const collectionsRoutes = require('./collectionsRoutes');
const shareRoutes = require('./shareRoutes');
const workflowsRoutes = require('./api/workflows');
const pointsRoutes = require('./api/points');
const pipelinesRoutes = require('./api/pipelines');
const statusRoutes = require('./api/status');
const fileRoutes = require('./fileRoutes');
const express = require('express'); // Ensure express is required if not already

/**
 * Initialize all routes for the web platform
 * @param {Express} app - Express application instance
 * @param {Object} services - Core services
 */
async function initializeRoutes(app, services) {
  // Mount API routes
  app.use('/api/auth', authRoutes(services));
  app.use('/api/collections', collectionsRoutes(services));
  app.use('/api/share', shareRoutes(services));
  app.use('/api/workflows', workflowsRoutes(services));
  app.use('/api/points', pointsRoutes(services));
  app.use('/api/pipelines', pipelinesRoutes);
  app.use('/api/status', statusRoutes(services));
  
  // Mount direct file routes
  app.use('/files', fileRoutes());
  
  // --- BEGIN DYNAMIC WORKFLOW ROUTES ---
  try {
    const workflowsService = services.workflows; // Assuming service name is 'workflows'
    const comfyuiService = services.comfyui; // Assuming service name is 'comfyui'
    
    if (workflowsService && comfyuiService && typeof workflowsService.getWorkflows === 'function') {
      const internalWorkflowRouter = express.Router();
      const workflows = await workflowsService.getWorkflows(); // Use getWorkflows

      workflows.forEach(workflow => {
        // Ensure workflow.name exists before creating route
        if (workflow && workflow.name) {
          const routePath = `/${workflow.name}/run`;
          console.log(`[Web Routes] Registering internal workflow route: POST /api/internal/run${routePath}`);
          
          internalWorkflowRouter.post(routePath, async (req, res, next) => {
            // Define workflowName here, using the workflow object from the outer scope
            const workflowName = workflow.name; 
            
            try {
              // Remove the definition from inside the try block
              // const workflowName = workflow.name; 
              
              const userInput = req.body || {};
  
              // Log expected inputs for debugging
              const expectedInputs = await workflowsService.getWorkflowRequiredInputs(workflowName);
              console.log(`[Web Routes] Validating inputs for '${workflowName}'. Expected inputs:`, JSON.stringify(expectedInputs, null, 2));
              console.log(`[Web Routes] Received inputs:`, JSON.stringify(userInput, null, 2));

              // 1. Validate and merge inputs (use workflowName)
              const validationResult = await workflowsService.validateInputPayload(workflowName, userInput);
              if (!validationResult.isValid) {
                // Log the detailed validation result for debugging
                console.error(`[Web Routes] Input validation failed for '${workflowName}'. Details:`, JSON.stringify(validationResult, null, 2));
                return res.status(400).json({ 
                  status: 'error', 
                  message: 'Input validation failed', 
                  errors: validationResult // Include full validation result in response
                });
              }
              
              // Use workflowName
              const finalPayload = await workflowsService.mergeWithDefaultInputs(workflowName, userInput);
  
              // 2. Get Deployment ID (use workflowName)
              const deploymentIds = await workflowsService.getDeploymentIdsByName(workflowName);
              if (!deploymentIds || deploymentIds.length === 0) {
                 return res.status(404).json({ 
                   status: 'error', 
                   message: `Deployment ID not found for workflow '${workflowName}'`
                 });
              }
              // Use the first deployment ID found for this workflow name
              const deploymentId = deploymentIds[0]; 
  
              // 3. Submit request via ComfyUI Service (use workflowName)
              const runId = await comfyuiService.submitRequest({ 
                deploymentId: deploymentId,
                inputs: finalPayload,
                workflowName: workflowName // Pass name for machine routing
              }); 
  
              // 4. Respond to client
              res.status(202).json({ // 202 Accepted is appropriate for async job submission
                status: 'success',
                message: `Workflow '${workflowName}' queued successfully.`,
                job: { run_id: runId } // Return the run ID
              });

            } catch (error) {
              // workflowName is now guaranteed to be defined in this scope
              console.error(`Error processing internal workflow request for '${workflowName}':`, error);
              // Pass error to the default Express error handler
              next(error); 
            }
          });
        } else {
           console.warn(`[Web Routes] Skipping route generation for invalid workflow object: ${JSON.stringify(workflow)}`);
        }
      });

      // Mount the dynamic router
      app.use('/api/internal/run', internalWorkflowRouter);
      
    } else {
       console.warn('[Web Routes] WorkflowsService or ComfyUIService not available or getWorkflows method missing. Skipping dynamic route generation.');
    }
  } catch (error) {
    console.error('[Web Routes] Error setting up dynamic workflow routes:', error);
    // Decide if this should prevent startup or just log
  }
  // --- END DYNAMIC WORKFLOW ROUTES ---
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  
  // API documentation
  app.get('/api', (req, res) => {
    res.status(200).json({
      name: 'StationThis API',
      version: '1.0.0',
      endpoints: [
        { path: '/api/auth', description: 'Authentication endpoints' },
        { path: '/api/collections', description: 'Collection management' },
        { path: '/api/share', description: 'Collection sharing' },
        { path: '/api/workflows', description: 'Workflow execution and configuration' },
        { path: '/api/points', description: 'Point balance and transactions' },
        { path: '/api/pipelines', description: 'Pipeline templates and execution' },
        { path: '/api/status', description: 'Application status information' },
        { path: '/files', description: 'Direct access to client files' }
      ]
    });
  });
}

module.exports = {
  initializeRoutes
}; 