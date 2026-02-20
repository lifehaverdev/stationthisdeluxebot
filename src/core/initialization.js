/**
 * StationThis Core Initialization
 * 
 * This module centralizes all initialization logic for the StationThis system.
 * It incorporates legacy database checks with new API connectivity verification.
 */

// In-memory data structures
const burns = [];
const rooms = [];
const flows = [];
const loraTriggers = [];

/**
 * Read burns data from database
 * @param {Object} services - Service instances including DB
 * @param {Object} logger - Logger instance
 * @returns {Promise<Array>} - Array of burn objects
 */
async function loadBurnsData(services, logger) {
  logger.info('Loading burns data from database...');
  
  try {
    // Use proper DB model method
    const burnsData = services.db.models?.burns ? 
      await services.db.models.burns.getAll() : 
      [];
    
    burns.length = 0;
    
    if (burnsData && burnsData.length) {
      // Process burns data
      const burnsMap = new Map();
      
      burnsData.forEach(doc => {
        const wallet = doc.wallet;
        const burnts = doc.burns || [];
        
        if (!burnsMap.has(wallet)) {
          burnsMap.set(wallet, 0);
        }
        
        burnts.forEach(burn => {
          burnsMap.set(wallet, burnsMap.get(wallet) + (burn.amount || 0));
        });
      });
      
      burnsMap.forEach((burned, wallet) => {
        burns.push({ wallet, burned });
      });
    }
    
    logger.debug(`Burns data loaded successfully: ${burns.length} records`);
    return burns;
  } catch (error) {
    logger.error('Error loading burns data:', error);
    logger.warn('Continuing with empty burns data');
    return [];
  }
}

/**
 * Read rooms/groups data from database
 * @param {Object} services - Service instances including DB
 * @param {Object} logger - Logger instance
 * @returns {Promise<Array>} - Array of room objects
 */
async function loadRoomsData(services, logger) {
  logger.info('Loading rooms/groups data from database...');
  
  try {
    // Use proper DB model method
    const roomsData = services.db.models?.floorplan ? 
      await services.db.models.floorplan.getAll() : 
      [];
    
    rooms.length = 0;
    
    if (roomsData && roomsData.length) {
      roomsData.forEach(doc => {
        rooms.push(doc);
      });
      
      logger.debug(`Rooms data loaded successfully: ${rooms.length} rooms`);
    } else {
      logger.debug('No rooms data found');
    }
    
    return rooms;
  } catch (error) {
    logger.error('Error loading rooms data:', error);
    logger.warn('Continuing with empty rooms data');
    return [];
  }
}

/**
 * Parse workflow inputs
 * @param {Object} workflow - Workflow object
 * @returns {Array} - Array of workflow inputs
 */
function parseWorkflow(workflow) {
  let workflowInputs = [];
  
  try {
    // Check if workflow has nodes property
    if (!workflow || !workflow.nodes || !Array.isArray(workflow.nodes)) {
      return workflowInputs;
    }
    
    // Filter nodes that start with 'ComfyUIDeploy'
    const deployNodes = workflow.nodes.filter(node => 
      node && node.type && node.type.startsWith('ComfyUIDeploy')
    );

    deployNodes.forEach(node => {
      if (node.widgets_values && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        // Collect relevant inputs from widgets_values
        node.widgets_values.forEach(value => {
          if (typeof value === 'string' && value.startsWith('input_')) {
            workflowInputs.push(value);
          }
        });
      }
    });
  } catch (error) {
    console.error('Error parsing workflow:', error);
  }

  return workflowInputs;
}

/**
 * Read workflows data from database
 * @param {Object} services - Service instances including DB
 * @param {Object} logger - Logger instance
 * @returns {Promise<Array>} - Array of workflow objects
 */
async function loadWorkflowsData(services, logger) {
  logger.info('Loading workflows data from database...');
  
  try {
    // Use proper DB model method 
    const workflowsData = services.db.models?.workflows ? 
      await services.db.models.workflows.getAll() : 
      [];
    
    flows.length = 0;
    
    if (workflowsData && workflowsData.length && workflowsData[0]?.flows) {
      const flowsData = workflowsData[0].flows;
      
      for (const flow of flowsData) {
        try {
          const layout = flow.layout ? JSON.parse(flow.layout) : { nodes: [] };
          const parsedInputs = parseWorkflow(layout);
          
          flows.push({
            name: flow.name || 'Unnamed workflow',
            ids: flow.ids || [],
            inputs: parsedInputs
          });
        } catch (parseError) {
          logger.error(`Error parsing workflow layout for ${flow.name || 'unnamed workflow'}:`, parseError);
        }
      }
    }
    
    logger.debug(`Workflows data loaded successfully: ${flows.length} workflows`);
    return flows;
  } catch (error) {
    logger.error('Error loading workflows data:', error);
    logger.warn('Continuing with empty workflows data');
    return [];
  }
}

/**
 * Load lora data from database
 * @param {Object} services - Service instances including DB
 * @param {Object} logger - Logger instance
 * @returns {Promise<Array>} - Array of lora triggers
 */
async function loadLorasData(services, logger) {
  logger.info('Loading lora data from database...');
  
  try {
    // Use proper DB model method
    const lorasData = services.db.models?.loras ? 
      await services.db.models.loras.getAll() : 
      [];
    
    loraTriggers.length = 0;
    
    if (lorasData && lorasData.length && lorasData[0]?.loraTriggers) {
      lorasData[0].loraTriggers.forEach(triggerStr => {
        if (triggerStr) loraTriggers.push(triggerStr);
      });
    }
    
    logger.debug(`Loras data loaded successfully: ${loraTriggers.length} lora triggers`);
    return loraTriggers;
  } catch (error) {
    logger.error('Error loading loras data:', error);
    logger.warn('Continuing with empty lora triggers');
    return [];
  }
}

/**
 * Check ComfyUI API connectivity
 * @param {Object} comfyUIService - ComfyUI service instance
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} - API status object
 */
async function checkComfyUIAPI(comfyUIService, logger) {
  logger.info('Checking ComfyUI Deploy API connectivity...');
  
  try {
    // Test API connectivity using already-cached machines + deployments (fast, no workflow fetch)
    const apiDeployments = await comfyUIService.getDeployments();
    logger.info(`ComfyUI API: ${apiDeployments.length} deployments available`);

    const apiMachines = await comfyUIService.getMachines();
    const readyMachines = apiMachines.filter(m => m.status === 'ready').length;
    logger.info(`ComfyUI API: ${apiMachines.length} machines (${readyMachines} ready)`);

    return {
      connected: true,
      deployments: apiDeployments.length,
      machines: apiMachines.length,
      readyMachines
    };
  } catch (error) {
    logger.error(`Failed to connect to ComfyUI API: ${error.message}`);
    return {
      connected: false,
      error: error.message
    };
  }
}

/**
 * Initialize the StationThis system
 * @param {Object} services - Service instances
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} - Initialization results
 */
async function initialize(services, logger) {
  try {
    // Verify DB service is available
    if (!services.db || !services.db.models) {
      logger.warn('Database service not properly initialized - using mock data');
    } else {
      // Log database information
      logger.info('Database service available:');
      const models = Object.keys(services.db.models).filter(key =>
        services.db.models[key] && typeof services.db.models[key] === 'object'
      );
      logger.info(`- Available models: ${models.join(', ')}`);
    }

    // Step 1: Load data from database
    logger.info('=== STEP 1: Loading data from database ===');
    const burnsData = await loadBurnsData(services, logger);
    const roomsData = await loadRoomsData(services, logger);
    const workflowsData = await loadWorkflowsData(services, logger);
    const lorasData = await loadLorasData(services, logger);

    // Step 2: Check ComfyUI API connectivity
    logger.info('=== STEP 2: Checking ComfyUI API connectivity ===');
    const comfyUIStatus = await checkComfyUIAPI(services.comfyUI, logger);

    // Step 3: Check additional database systems
    logger.info('=== STEP 3: Checking additional database systems ===');
    // TODO: Add checks for user_core and global_status

    logger.info('==== INITIALIZATION COMPLETE ====');
    
    // Return initialization results
    return {
      status: 'success',
      data: {
        burns: burnsData.length,
        rooms: roomsData.length,
        workflows: workflowsData.length,
        loras: lorasData.length,
        comfyUI: comfyUIStatus
      }
    };
  } catch (error) {
    logger.error('Initialization failed:', error);
    // Return partial initialization results
    return {
      status: 'partial',
      error: error.message,
      data: {
        burns: burns.length,
        rooms: rooms.length,
        workflows: flows.length,
        loras: loraTriggers.length,
        comfyUI: { connected: false }
      }
    };
  }
}

module.exports = {
  initialize,
  loadBurnsData,
  loadRoomsData,
  loadWorkflowsData,
  loadLorasData,
  checkComfyUIAPI,
  burns,
  rooms,
  flows,
  loraTriggers
}; 