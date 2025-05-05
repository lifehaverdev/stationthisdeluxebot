/**
 * Database Service
 * 
 * Adapter for the existing DB infrastructure in /db
 */

const { BaseDB } = require('../../../db/models/BaseDB');
const dbModels = require('../../../db');
const FloorplanDB = require('../../../db/models/floorplan');
const BurnsDB = require('../../../db/models/burns');
const WorkflowDB = require('../../../db/models/workflows');
const LoraDB = require('../../../db/models/loralist');

// Create instances of DB model classes with proper error handling
const createModelInstance = (ModelClass, name) => {
    try {
        return new ModelClass();
    } catch (error) {
        console.error(`Error initializing ${name} database model:`, error);
        return null;
    }
};

// Initialize DB models 
const burns = createModelInstance(BurnsDB, 'burns');
const floorplan = createModelInstance(FloorplanDB, 'floorplan');
const workflows = createModelInstance(WorkflowDB, 'workflows');
const loras = createModelInstance(LoraDB, 'loras');

// Wrapper functions with error handling for database operations
const safeDbOperation = async (operation, defaultValue) => {
    try {
        return await operation();
    } catch (error) {
        console.error(`Database operation failed:`, error);
        return defaultValue;
    }
};

// Pipeline templates collection
class PipelineTemplatesDB extends BaseDB {
    constructor() {
        super('pipeline_templates');
    }
}

// Create instances of DB models
const pipelineTemplates = createModelInstance(PipelineTemplatesDB, 'pipeline_templates');

/**
 * Execute database queries using our BaseDB infrastructure
 * Provides compatibility with the existing pipeline API code
 */
async function query(sql, params = []) {
    // This is a SQL-like interface adapter for MongoDB
    
    if (sql.includes('SELECT * FROM pipeline_templates WHERE user_id = ?')) {
        // Get templates by user ID
        return safeDbOperation(
            () => pipelineTemplates.findMany({ user_id: params[0] }),
            []
        );
    }
    
    if (sql.includes('INSERT INTO pipeline_templates')) {
        // Create template
        const [id, userId, name, description, tiles, connections, createdAt] = params;
        return safeDbOperation(
            () => pipelineTemplates.insertOne({
                id,
                user_id: userId,
                name, 
                description,
                tiles,
                connections,
                created_at: createdAt
            }),
            { acknowledged: false }
        );
    }
    
    if (sql.includes('SELECT * FROM pipeline_templates WHERE id = ? AND user_id = ?')) {
        // Get template by ID and user ID
        const [templateId, userId] = params;
        return safeDbOperation(
            () => pipelineTemplates.findMany({ id: templateId, user_id: userId }),
            []
        );
    }
    
    if (sql.includes('DELETE FROM pipeline_templates WHERE id = ? AND user_id = ?')) {
        // Delete template
        const [templateId, userId] = params;
        const result = await safeDbOperation(
            () => pipelineTemplates.deleteOne({ id: templateId, user_id: userId }),
            { deletedCount: 0 }
        );
        return { affectedRows: result.deletedCount };
    }
    
    throw new Error(`Unsupported query: ${sql}`);
}

// Enhanced DB models with proper error handling
const enhancedModels = {
    // Burns operations
    burns: burns ? {
        getAll: () => safeDbOperation(() => burns.getAllBurns(), []),
        findMany: (filter) => safeDbOperation(() => burns.findMany(filter), []),
        findOne: (filter) => safeDbOperation(() => burns.findOne(filter), null)
    } : null,
    
    // Floorplan operations
    floorplan: floorplan ? {
        getAll: () => safeDbOperation(() => floorplan.getAllFloors(), []),
        findMany: (filter) => safeDbOperation(() => floorplan.findMany(filter), []),
        findOne: (filter) => safeDbOperation(() => floorplan.findOne(filter), null),
        writeRoomData: (groupId, data) => safeDbOperation(() => floorplan.writeRoomData(groupId, data), null),
        createRoom: (groupId, roomData) => safeDbOperation(() => floorplan.createRoom(groupId, roomData), null),
        saveGroupSettings: (groupId, settings) => safeDbOperation(() => floorplan.saveGroupSettings(groupId, settings), null),
        writeGroupQoints: (groupId, qoints) => safeDbOperation(() => floorplan.writeGroupQoints(groupId, qoints), null)
    } : null,
    
    // Workflows operations
    workflows: workflows ? {
        getAll: () => safeDbOperation(() => workflows.getActiveFlows(), []),
        findMany: (filter) => safeDbOperation(() => workflows.findMany(filter), []),
        findOne: (filter) => safeDbOperation(() => workflows.findOne(filter), null)
    } : null,
    
    // Loras operations
    loras: loras ? {
        getAll: () => safeDbOperation(() => loras.getActiveLoras(), []),
        findMany: (filter) => safeDbOperation(() => loras.findMany(filter), []),
        findOne: (filter) => safeDbOperation(() => loras.findOne(filter), null)
    } : null,
    
    // Pipeline templates operations
    pipelineTemplates: pipelineTemplates ? {
        getAll: () => safeDbOperation(() => pipelineTemplates.findMany({}), []),
        findMany: (filter) => safeDbOperation(() => pipelineTemplates.findMany(filter), []),
        findOne: (filter) => safeDbOperation(() => pipelineTemplates.findOne(filter), null),
        insertOne: (data) => safeDbOperation(() => pipelineTemplates.insertOne(data), null),
        deleteOne: (filter) => safeDbOperation(() => pipelineTemplates.deleteOne(filter), null)
    } : null
};

// Export extended models and utilities
module.exports = {
    query,
    models: {
        ...dbModels,
        // Add our enhanced models with proper error handling
        ...enhancedModels
    }
}; 