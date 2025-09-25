const fs = require('fs');
const path = require('path');


// Adjust paths based on your project structure
// Assuming this script is run from the root of the project, or paths are adjusted accordingly.
const { initializeServices } = require('../../src/core/services'); // Path to your service initializer
// ToolRegistry is exported from initializeServices module, so we can get it from there if needed
// or import directly if its path is stable and it always returns the same singleton.
// const { ToolRegistry } = require('../src/core/tools/ToolRegistry');

async function flashRegistry() {
  console.log('Initializing services to populate ToolRegistry...');
  
  // Minimal logger for service initialization
  const logger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log, // Or a more sophisticated logger if your services need it
  };

  try {
    // Initialize services. This should populate the ToolRegistry via WorkflowCacheManager.
    // Pass any necessary minimal config. This is highly app-specific.
    // For example, API keys for ComfyDeploy might be needed via process.env
    // Ensure your .env file or environment variables are set up if ComfyUI service needs them.

    // Explicitly check for COMFY_DEPLOY_API_KEY before initializing services
    if (!process.env.COMFY_DEPLOY_API_KEY) {
      logger.error('CRITICAL: COMFY_DEPLOY_API_KEY is not set in the environment.');
      logger.error('Please ensure it is defined in your .env file and the .env file is being loaded correctly.');
      logger.error('The flashToolRegistry script cannot function without this key.');
      process.exit(1);
    } else {
      logger.info('COMFY_DEPLOY_API_KEY found in environment.'); // Add this for positive confirmation
    }

    const mediaConfig = {
      tempDir: path.join(__dirname, '..', 'tmp'), // Default similar to MediaService
      storageDir: path.join(__dirname, '..', 'storage', 'media') // Default similar to MediaService
    };

    const initializeTimeoutMs = 300000; // 5 minutes, adjust as needed

    const servicesPromise = initializeServices({
      logger,
      mediaConfig, // Add mediaConfig
      // Add other necessary minimal configurations for services to initialize
      // e.g., mediaConfig if MediaService requires it, etc.
      // This might require looking into what initializeServices and its children (like ComfyUIService/WorkflowCacheManager) expect.
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Service initialization timed out after ${initializeTimeoutMs / 1000} seconds. The ToolRegistry might be taking too long to populate or a service isn't resolving.`)), initializeTimeoutMs)
    );
    
    console.log(`Initializing services (with a ${initializeTimeoutMs / 1000}s timeout)...`);
    const services = await Promise.race([servicesPromise, timeoutPromise]);

    if (!services || !services.toolRegistry) {
      console.error('Failed to get ToolRegistry from initialized services.');
      if (services) {
        console.error('Services object was returned, but toolRegistry key is missing or falsy.');
        console.error('Available keys in services:', Object.keys(services).join(', '));
      } else {
        console.error('Services object itself is null or undefined after initialization.');
      }
      process.exit(1);
    }

    // Ensure WorkflowsService (and its CacheManager) is initialized
    if (services.workflows && typeof services.workflows.initialize === 'function') {
      console.log('Explicitly initializing WorkflowsService...');
      try {
        await services.workflows.initialize();
        console.log('WorkflowsService initialized successfully.');
      } catch (error) {
        console.error('Error during explicit WorkflowsService initialization:', error);
        // Decide if you want to exit or continue if workflow init fails
        process.exit(1); 
      }
    } else {
      console.warn('services.workflows.initialize is not available. ToolRegistry might be empty.');
    }

    const toolRegistry = services.toolRegistry; // Get the instance from initialized services

    console.log('Fetching all tools from ToolRegistry...');
    let tools = toolRegistry.getAllTools();

    // --- Enrich tools with historical average cost/duration ---
    const generationOutputsDb = services.db?.data?.generationOutputs;
    if (generationOutputsDb) {
      console.log('Enriching tools with historical cost averages...');
      const enrichedTools = [];
      for (const tool of tools) {
        if (tool.costingModel && tool.costingModel.rateSource !== 'static') {
          try {
            const pipeline = [
              { $match: { toolDisplayName: tool.displayName, durationMs: { $gt: 0 }, costUsd: { $gt: 0 } } },
              { $group: { _id: null, avgDuration: { $avg: '$durationMs' }, avgCost: { $avg: '$costUsd' } } }
            ];
            const resultArr = await generationOutputsDb.aggregate(pipeline);
            if (resultArr && resultArr[0]) {
              const { avgDuration, avgCost } = resultArr[0];
              if (avgDuration && avgCost) {
                const sec = avgDuration / 1000;
                const rate = sec > 0 ? avgCost / sec : null;
                if (rate) {
                  tool.costingModel.rate = parseFloat(rate.toFixed(6));
                  tool.costingModel.unit = 'second';
                  tool.costingModel.rateSource = 'historical';
                  tool.metadata = tool.metadata || {}; // Ensure metadata exists
                  tool.metadata.avgHistoricalCost = avgCost;
                  tool.metadata.avgHistoricalDurationMs = avgDuration;
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to enrich cost for tool ${tool.toolId}:`, err.message);
          }
        }
        enrichedTools.push(tool);
      }
      tools = enrichedTools;
    } else {
      console.warn('generationOutputsDb not available; skipping historical cost enrichment.');
    }

    if (tools.length === 0) {
      console.warn('Warning: ToolRegistry is empty. The output file will be an empty array. Ensure services initialized correctly and workflows were found.');
      // Add more diagnostic info here if possible
      if (services.comfyUI) {
        // Access static property S_IS_INITIALIZED directly via constructor
        console.log(`ComfyUI Service S_IS_INITIALIZED: ${services.comfyUI.constructor.S_IS_INITIALIZED}`);
        // Log the API URL being used by ComfyUIService instance
        if (services.comfyUI.apiUrl) {
          console.log(`ComfyUI Service API URL: ${services.comfyUI.apiUrl}`);
        }
      }
      if (services.workflows && services.workflows.cacheManager) {
         // cacheManager.isInitialized is a boolean property
         console.log(`Workflows Service Cache Manager isInitialized: ${services.workflows.cacheManager.isInitialized}`);
         console.log(`Workflows Service Cache Manager isLoading: ${services.workflows.cacheManager.isLoading}`);
         console.log(`Workflows Service Cache Manager _hasInitializedOnce: ${services.workflows.cacheManager._hasInitializedOnce}`);
         // The getInitializationError was a good idea, but let's assume it's not there for now to avoid more TypeErrors
         // We'll rely on S_IS_INITIALIZED from ComfyUIService and the cacheManager flags for now.
      }
    }

    const outputPath = path.join(__dirname, '..', 'tool_registry.generated.json'); 
    fs.writeFileSync(outputPath, JSON.stringify(tools, null, 2));
    console.log(`ToolRegistry flashed successfully to ${outputPath} (${tools.length} tools written).`);

    // Optional: Validate the registry after populating and before writing
    const validationResult = toolRegistry.validate();
    if (!validationResult.isValid) {
        console.warn('Validation issues found in the flashed ToolRegistry:');
        validationResult.errors.forEach(err => console.warn(`  ToolID: ${err.toolId}, Message: ${err.message}`));
    } else {
        console.log('ToolRegistry validation passed.');
    }

  } catch (error) {
    console.error('Error during flashRegistry script execution:', error);
    process.exit(1);
  }
  process.exit(0);
}

// Load .env variables if the script is run directly and services need them
if (require.main === module) {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
    flashRegistry().catch(err => {
        console.error('Unhandled error in flashRegistry:', err);
        process.exit(1);
    });
} 