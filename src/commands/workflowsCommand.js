/**
 * Workflows Command
 * 
 * Lists all available ComfyDeploy workflows loaded from the database.
 * Shows which workflows are active and their required inputs.
 */

const { Command } = require('../core/command/Command');
const internalAPI = require('../core/internalAPI');

class WorkflowsCommand extends Command {
  constructor() {
    super({
      name: 'workflows',
      description: 'List all available ComfyDeploy workflows',
      usage: '/workflows',
      aliases: ['wf', 'flows'],
      category: 'comfydeploy',
      requiredPermissions: ['user'],
      cooldown: 5
    });
  }

  /**
   * Execute the workflows command
   * @param {Object} context - Command execution context
   * @returns {Promise<Object>} Command response
   */
  async execute(context) {
    const { user } = context;
    
    try {
      // Get workflows from the internal API
      const response = await internalAPI.getWorkflows();
      
      if (response.status !== 'ok' || !response.workflows || response.workflows.length === 0) {
        return {
          message: 'No workflows available. Please check back later.',
          type: 'text'
        };
      }
      
      // Format the response
      const activeWorkflows = response.workflows.filter(wf => wf.active);
      const inactiveWorkflows = response.workflows.filter(wf => !wf.active);
      
      let message = '🔄 *Available Workflows*\n\n';
      
      // Show active workflows
      message += '*Active Workflows:*\n';
      if (activeWorkflows.length === 0) {
        message += '- No active workflows\n';
      } else {
        activeWorkflows.forEach(workflow => {
          message += `- \`${workflow.name}\` (${workflow.inputs.length} inputs)\n`;
        });
      }
      
      // Show inactive workflows if any
      if (inactiveWorkflows.length > 0) {
        message += '\n*Inactive Workflows:*\n';
        inactiveWorkflows.forEach(workflow => {
          message += `- \`${workflow.name}\` (inactive)\n`;
        });
      }
      
      // Add usage instructions
      message += '\nUse `/workflow [name]` to get details about a specific workflow.';
      
      return {
        message,
        type: 'text',
        options: {
          parse_mode: 'Markdown'
        }
      };
    } catch (error) {
      console.error('Error executing workflows command:', error);
      
      return {
        message: 'Sorry, there was an error retrieving workflows. Please try again later.',
        type: 'text'
      };
    }
  }
}

module.exports = new WorkflowsCommand(); 