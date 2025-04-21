/**
 * WorkflowRepository - Handles database operations for workflow definitions
 * 
 * This module implements the repository pattern for workflow data access.
 */

const { AppError } = require('../../core/shared/errors/AppError');
const { BaseRepository } = require('../../core/shared/repository/baseRepository');

class WorkflowRepository extends BaseRepository {
  /**
   * Create a new WorkflowRepository instance
   * 
   * @param {Object} options Configuration options
   * @param {string} options.collectionName Name of the collection (defaults to 'workflows')
   * @param {Object} options.db Database connection or service
   * @param {Object} options.logger Logger instance
   */
  constructor({ collectionName = 'workflows', db, logger }) {
    super({ collectionName, db, logger });
    this.logger = logger;
  }

  /**
   * Parse workflow inputs from the flow's layout
   * 
   * @param {Array} flows Array of flow objects from the database
   * @returns {Array} Array of parsed workflow objects
   * @private
   */
  _parseWorkflowInputs(flows) {
    if (!Array.isArray(flows)) {
      this.logger.warn(`[WorkflowRepository] Invalid flows data: not an array`, {
        flowsType: typeof flows,
        flowsValue: flows
      });
      return [];
    }

    this.logger.debug(`[WorkflowRepository] Parsing ${flows.length} workflows`);
    
    return flows.map(flow => {
      let parsedInputs = [];
      
      try {
        if (!flow.layout) {
          this.logger.warn(`[WorkflowRepository] Missing layout for workflow: ${flow.name}`);
          return {
            name: flow.name,
            inputs: [],
            ids: flow.ids || [],
            active: flow.active !== false
          };
        }
        
        // Parse the layout if it's a string
        let layout;
        if (typeof flow.layout === 'string') {
          try {
            layout = JSON.parse(flow.layout);
          } catch (error) {
            this.logger.error(`[WorkflowRepository] Error parsing layout JSON for workflow: ${flow.name}`, { 
              error: error.message
            });
            return {
              name: flow.name,
              inputs: [],
              ids: flow.ids || [],
              active: flow.active !== false
            };
          }
        } else if (typeof flow.layout === 'object') {
          layout = flow.layout;
        } else {
          this.logger.warn(`[WorkflowRepository] Invalid layout type for workflow: ${flow.name}`);
          return {
            name: flow.name,
            inputs: [],
            ids: flow.ids || [],
            active: flow.active !== false
          };
        }
        
        // Check if the layout has nodes
        if (!layout.nodes || !Array.isArray(layout.nodes)) {
          this.logger.warn(`[WorkflowRepository] Invalid layout structure for workflow: ${flow.name}`);
          return {
            name: flow.name,
            inputs: [],
            ids: flow.ids || [],
            active: flow.active !== false
          };
        }
        
        // Filter nodes that start with 'ComfyUIDeploy'
        const deployNodes = layout.nodes.filter(node => node.type && node.type.startsWith('ComfyUIDeploy'));
        
        // Extract inputs from widgets_values
        deployNodes.forEach(node => {
          if (node.widgets_values && node.widgets_values.length > 0) {
            node.widgets_values.forEach(value => {
              if (typeof value === 'string' && value.startsWith('input_')) {
                parsedInputs.push(value);
              }
            });
          }
        });
        
        return {
          name: flow.name,
          inputs: parsedInputs,
          ids: flow.ids || [],
          active: flow.active !== false
        };
      } catch (error) {
        this.logger.error(`[WorkflowRepository] Error parsing workflow: ${flow.name || 'unnamed'}`, { 
          error: error.message
        });
        
        return {
          name: flow.name || 'unnamed',
          inputs: [],
          ids: flow.ids || [],
          active: flow.active !== false
        };
      }
    });
  }

  /**
   * Find all workflows from the main workflow document
   * 
   * @returns {Promise<Array>} Array of workflow definitions
   */
  async findAll() {
    try {
      this.logger.info(`[WorkflowRepository] Finding all workflows`);
      
      // Get the collection and execute the query
      const collection = this.getCollection();
      
      // Execute the query
      const doc = await collection.findOne({});
      
      if (!doc) {
        this.logger.warn(`[WorkflowRepository] No workflow document found in collection, returning mock workflows`);
        // Provide fallback mock workflows
        return [
          {
            name: 'MAKE_IMAGE',
            inputs: ['input_prompt', 'input_negative_prompt', 'input_width', 'input_height', 'input_steps', 'input_cfg', 'input_seed'],
            ids: ['mock-id-1'],
            active: true
          },
          {
            name: 'UPSCALE_IMAGE',
            inputs: ['input_image', 'input_scale', 'input_strength'],
            ids: ['mock-id-2'],
            active: true
          },
          {
            name: 'RMBG_IMAGE',
            inputs: ['input_image'],
            ids: ['mock-id-3'],
            active: true
          }
        ];
      }

      if (!doc.flows || !Array.isArray(doc.flows)) {
        this.logger.warn(`[WorkflowRepository] Workflow document has invalid 'flows' property, returning mock workflows`);
        // Provide fallback mock workflows
        return [
          {
            name: 'MAKE_IMAGE',
            inputs: ['input_prompt', 'input_negative_prompt', 'input_width', 'input_height', 'input_steps', 'input_cfg', 'input_seed'],
            ids: ['mock-id-1'],
            active: true
          },
          {
            name: 'UPSCALE_IMAGE',
            inputs: ['input_image', 'input_scale', 'input_strength'],
            ids: ['mock-id-2'],
            active: true
          },
          {
            name: 'RMBG_IMAGE',
            inputs: ['input_image'],
            ids: ['mock-id-3'],
            active: true
          }
        ];
      }

      const workflows = this._parseWorkflowInputs(doc.flows);
      this.logger.info(`[WorkflowRepository] Retrieved ${workflows.length} workflows`);
      return workflows;
    } catch (error) {
      this.logger.error(`[WorkflowRepository] Error finding all workflows: ${error.message}`);
      // Return mock workflows in case of error
      this.logger.warn(`[WorkflowRepository] Returning mock workflows due to error`);
      return [
        {
          name: 'MAKE_IMAGE',
          inputs: ['input_prompt', 'input_negative_prompt', 'input_width', 'input_height', 'input_steps', 'input_cfg', 'input_seed'],
          ids: ['mock-id-1'],
          active: true
        },
        {
          name: 'UPSCALE_IMAGE',
          inputs: ['input_image', 'input_scale', 'input_strength'],
          ids: ['mock-id-2'],
          active: true
        },
        {
          name: 'RMBG_IMAGE',
          inputs: ['input_image'],
          ids: ['mock-id-3'],
          active: true
        }
      ];
    }
  }

  /**
   * Find a workflow by name
   * 
   * @param {string} name The workflow name
   * @returns {Promise<Object|null>} Workflow definition or null if not found
   */
  async findByName(name) {
    try {
      this.logger.debug(`[WorkflowRepository] Finding workflow by name: ${name}`);
      const collection = this.getCollection();
      
      this.logger.debug(`[WorkflowRepository] Executing db query: { collection: '${this.collectionName}', operation: 'findOne', filter: {}, projection: { flows: { $elemMatch: { name: '${name}' } } } }`);
      const doc = await collection.findOne({}, { 
        projection: { 
          flows: { $elemMatch: { name } } 
        }
      });
      
      this.logger.debug(`[WorkflowRepository] Query result received for workflow: ${name}`, { 
        found: !!doc, 
        hasFlows: doc && !!doc.flows,
        flowsLength: doc?.flows?.length || 0,
        flowNames: doc?.flows?.map(f => f.name) || [] 
      });

      if (!doc || !doc.flows || !doc.flows.length) {
        this.logger.warn(`[WorkflowRepository] Workflow not found with name: ${name}`);
        return null;
      }

      const workflows = this._parseWorkflowInputs(doc.flows);
      if (!workflows.length) {
        this.logger.warn(`[WorkflowRepository] Failed to parse workflow with name: ${name}`);
        return null;
      }
      
      this.logger.debug(`[WorkflowRepository] Successfully found workflow: ${name}`);
      return workflows[0];
    } catch (error) {
      this.logger.error(`[WorkflowRepository] Error finding workflow by name ${name}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Find featured workflows
   * 
   * @param {number} limit Maximum number of workflows to return
   * @returns {Promise<Array>} Array of featured workflow definitions
   */
  async findFeatured(limit = 10) {
    try {
      const workflows = await this.findAll();
      // For now, just return all workflows, limited by the limit parameter
      // In the future, we might want to add a 'featured' flag to workflows
      return workflows.slice(0, limit);
    } catch (error) {
      this.logger.error('Failed to find featured workflows', { error });
      throw new AppError('Failed to find featured workflows', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Find active workflows
   * 
   * @returns {Promise<Array>} Array of active workflow definitions
   */
  async findActive() {
    try {
      const workflows = await this.findAll();
      return workflows.filter(workflow => workflow.active !== false);
    } catch (error) {
      this.logger.error('Failed to find active workflows', { error });
      throw new AppError('Failed to find active workflows', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Save a workflow
   * 
   * @param {Object} workflow Workflow definition to save
   * @returns {Promise<Object>} Saved workflow definition
   */
  async save(workflow) {
    try {
      const workflowDoc = await this.findOne({});
      
      if (!workflowDoc || !workflowDoc.flows) {
        // Create a new workflow document if none exists
        await this.insertOne({
          flows: [workflow]
        });
        return workflow;
      }
      
      // Check if workflow with this name already exists
      const existingIndex = workflowDoc.flows.findIndex(flow => flow.name === workflow.name);
      
      if (existingIndex >= 0) {
        // Update existing workflow
        workflowDoc.flows[existingIndex] = workflow;
      } else {
        // Add new workflow
        workflowDoc.flows.push(workflow);
      }
      
      // Update the document
      await this.updateOne({ _id: workflowDoc._id }, { flows: workflowDoc.flows });
      
      return workflow;
    } catch (error) {
      this.logger.error('Failed to save workflow', { error, workflow });
      throw new AppError('Failed to save workflow', 'DATABASE_ERROR', error);
    }
  }

  /**
   * Delete a workflow by name
   * 
   * @param {string} name The workflow name
   * @returns {Promise<boolean>} True if workflow was deleted
   */
  async deleteByName(name) {
    try {
      const workflowDoc = await this.findOne({});
      
      if (!workflowDoc || !workflowDoc.flows) {
        return false;
      }
      
      const initialLength = workflowDoc.flows.length;
      workflowDoc.flows = workflowDoc.flows.filter(flow => flow.name !== name);
      
      if (workflowDoc.flows.length === initialLength) {
        // No workflow was removed
        return false;
      }
      
      // Update the document
      await this.updateOne({ _id: workflowDoc._id }, { flows: workflowDoc.flows });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete workflow by name: ${name}`, { error });
      throw new AppError(`Failed to delete workflow by name: ${name}`, 'DATABASE_ERROR', error);
    }
  }
}

module.exports = { WorkflowRepository }; 