// require('dotenv').config();
const { MongoClient } = require('mongodb');
const { Logger } = require('./src/utils/logger');
const WorkflowDB = require('./db/models/workflows');
const { WorkflowRepository } = require('./src/db/repositories/workflowRepository');
const { DatabaseService } = require('./src/db/dbService');


// Create a logger
const logger = new Logger({
  level: 'debug',
  name: 'workflow-debug'
});

// Function to mimic the legacy workflow loading approach
async function loadWorkflowsLegacy() {
  logger.info('=== Loading workflows using LEGACY approach ===');
  
  const workflowDB = new WorkflowDB();
  logger.info('Legacy DB settings:', {
    collectionName: workflowDB.collectionName,
    dbName: workflowDB.dbName,
    botNameEnv: process.env.BOT_NAME
  });

  try {
    logger.info('Attempting to find workflow document using legacy WorkflowDB...');
    const document = await workflowDB.findOne();
    
    logger.info('Legacy workflow document:', {
      found: !!document,
      hasFlows: document && !!document.flows,
      flowsCount: document?.flows?.length || 0
    });
    
    if (document && document.flows) {
      logger.info('First flow from legacy approach:', {
        firstFlow: document.flows[0]
      });
      
      // Parse workflow inputs similar to the legacy approach
      const flows = document.flows.map(flow => {
        let parsedInputs = [];
        try {
          const layout = JSON.parse(flow.layout);
          // Filter nodes that start with 'ComfyUIDeploy'
          const deployNodes = layout.nodes.filter(node => node.type.startsWith('ComfyUIDeploy'));
          
          deployNodes.forEach(node => {
            if (node.widgets_values && node.widgets_values.length > 0) {
              node.widgets_values.forEach(value => {
                if (typeof value === 'string' && value.startsWith('input_')) {
                  parsedInputs.push(value);
                }
              });
            }
          });
        } catch (e) {
          logger.error('Error parsing workflow layout:', e);
        }
        
        return {
          name: flow.name,
          ids: flow.ids,
          inputs: parsedInputs
        };
      });
      
      logger.info(`Parsed ${flows.length} workflows from legacy approach`);
      return flows;
    } else {
      logger.warn('No workflows found using legacy approach');
      return [];
    }
  } catch (error) {
    logger.error('Error loading workflows using legacy approach:', error);
    return [];
  }
}

// Function to use our new repository approach
async function loadWorkflowsNew() {
  logger.info('=== Loading workflows using NEW repository approach ===');
  
  try {
    // Initialize DatabaseService with BOT_NAME as the database
    const uri = process.env.MONGODB_URI || process.env.MONGO_PASS || 'mongodb://localhost:27017/stationthis';
    const dbName = process.env.BOT_NAME;
    
    logger.info('Connecting to database', {
      uri: uri.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/, 'mongodb$1://$2:***@'),
      dbName: dbName || '(from URI)'
    });
    
    const dbService = new DatabaseService({
      uri: uri,
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        ...(dbName ? { dbName } : {})
      },
      logger
    });
    
    // Connect to the database
    await dbService.connect();
    logger.info('Database connected successfully');
    
    // Initialize the repository
    const workflowRepository = new WorkflowRepository({
      collectionName: 'workflows',
      db: dbService,
      logger
    });
    
    // Add detailed logging for debugging
    logger.info('Calling findAll on workflow repository...');
    
    // Get workflows
    const workflows = await workflowRepository.findAll();
    
    logger.info('Result from new repository approach:', {
      workflowCount: workflows.length
    });
    
    if (workflows.length > 0) {
      logger.info('First workflow from new approach:', {
        firstWorkflow: workflows[0]
      });
    }
    
    return workflows;
  } catch (error) {
    logger.error('Error loading workflows using new repository approach:', error);
    return [];
  }
}

// Connect directly to MongoDB to see the raw data
async function inspectMongoDBDirectly() {
  logger.info('=== Inspecting MongoDB directly ===');
  
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_PASS || 'mongodb://localhost:27017/stationthis';
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    
    // Get database name from URI or BOT_NAME
    const dbNameFromURI = uri.split('/').pop().split('?')[0];
    const dbNameToUse = process.env.BOT_NAME || dbNameFromURI;
    
    logger.info('Connected directly to MongoDB', {
      uriDbName: dbNameFromURI,
      botNameEnv: process.env.BOT_NAME,
      usingDbName: dbNameToUse
    });
    
    const db = client.db(dbNameToUse);
    
    // List all collections
    const collections = await db.listCollections().toArray();
    logger.info('Collections in database:', {
      dbName: dbNameToUse,
      collections: collections.map(c => c.name)
    });
    
    // Check workflows collection
    const workflowsCollection = db.collection('workflows');
    const workflowsCount = await workflowsCollection.countDocuments();
    logger.info(`Found ${workflowsCount} documents in workflows collection`, {
      dbName: dbNameToUse
    });
    
    // Get the first document
    if (workflowsCount > 0) {
      const firstDocument = await workflowsCollection.findOne();
      logger.info('Raw workflow document structure:', {
        keys: Object.keys(firstDocument),
        hasFlows: !!firstDocument.flows,
        flowsCount: firstDocument.flows?.length || 0,
        firstFlowKeys: firstDocument.flows?.[0] ? Object.keys(firstDocument.flows[0]) : []
      });
    }
    
    await client.close();
  } catch (error) {
    logger.error('Error inspecting MongoDB directly:', error);
  }
}

// Main function to run all checks
async function main() {
  logger.info('Starting workflow debug script');
  
  // First, inspect MongoDB directly
  await inspectMongoDBDirectly();
  
  // Load workflows using both approaches
  const legacyWorkflows = await loadWorkflowsLegacy();
  const newWorkflows = await loadWorkflowsNew();
  
  // Compare the results
  logger.info('=== Comparison ===', {
    legacyWorkflowCount: legacyWorkflows.length,
    newWorkflowCount: newWorkflows.length,
    match: legacyWorkflows.length === newWorkflows.length
  });
  
  // If both approaches found workflows, compare the first one
  if (legacyWorkflows.length > 0 && newWorkflows.length > 0) {
    const firstLegacy = legacyWorkflows[0];
    const firstNew = newWorkflows[0];
    
    logger.info('First workflow comparison:', {
      legacyName: firstLegacy.name,
      newName: firstNew.name,
      namesMatch: firstLegacy.name === firstNew.name,
      legacyInputsCount: firstLegacy.inputs.length,
      newInputsCount: firstNew.inputs?.length || 0,
      inputsMatch: JSON.stringify(firstLegacy.inputs) === JSON.stringify(firstNew.inputs || [])
    });
  }
  
  logger.info('Workflow debug script completed');
  process.exit(0);
}

// Run the main function
main().catch(error => {
  logger.error('Error running debug script:', error);
  process.exit(1);
}); 