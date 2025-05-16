const fs = require('fs');
const path = require('path');

// Adjust paths based on your project structure
// Assuming this script is run from the root of the project, or paths are adjusted accordingly.
const { initializeServices } = require('../src/core/services'); // Path to your service initializer
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

    const initializeTimeoutMs = 300000; // 5 minutes, adjust as needed

    const servicesPromise = initializeServices({
      logger,
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
      process.exit(1);
    }

    const toolRegistry = services.toolRegistry; // Get the instance from initialized services

    console.log('Fetching all tools from ToolRegistry...');
    const tools = toolRegistry.getAllTools();

    if (tools.length === 0) {
      console.warn('Warning: ToolRegistry is empty. The output file will be an empty array. Ensure services initialized correctly and workflows were found.');
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
}

// Load .env variables if the script is run directly and services need them
if (require.main === module) {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
    flashRegistry().catch(err => {
        console.error('Unhandled error in flashRegistry:', err);
        process.exit(1);
    });
} 