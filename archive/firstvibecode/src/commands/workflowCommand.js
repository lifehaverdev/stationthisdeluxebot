/**
 * Workflow Command
 * 
 * Shows details about a specific ComfyDeploy workflow.
 * Displays inputs required and how to use the workflow.
 */

const { Command } = require('../core/command/Command');
const internalAPI = require('../core/internalAPI');

class WorkflowCommand extends Command {
  constructor() {
    super({
      name: 'workflow',
      description: 'Show details about a specific workflow',
      usage: '/workflow [name]',
      aliases: ['wf-details', 'flow'],
      category: 'comfydeploy',
      requiredPermissions: ['user'],
      cooldown: 5
    });
  }

  /**
   * Execute the workflow command
   * @param {Object} context - Command execution context
   * @returns {Promise<Object>} Command response
   */
  async execute(context) {
    const { args, user } = context;
    
    // Check if a workflow name was provided
    if (!args || args.length === 0) {
      return {
        message: 'Please specify a workflow name. Use `/workflows` to see all available workflows.',
        type: 'text'
      };
    }
    
    const workflowName = args.join(' ');
    
    try {
      // Get the specific workflow from the internal API
      const response = await internalAPI.getWorkflowByName(workflowName);
      
      if (response.status !== 'ok' || !response.workflow) {
        return {
          message: `Workflow "${workflowName}" not found. Use \`/workflows\` to see all available workflows.`,
          type: 'text',
          options: {
            parse_mode: 'Markdown'
          }
        };
      }
      
      const workflow = response.workflow;
      
      // Format the response
      let message = `🔄 *Workflow: ${workflow.name}*\n\n`;
      
      // Show active status
      message += `*Status:* ${workflow.active ? '✅ Active' : '❌ Inactive'}\n\n`;
      
      // If inactive, show a message
      if (!workflow.active) {
        message += '*This workflow is currently unavailable.*\n\n';
      }
      
      // Show inputs
      message += '*Required Inputs:*\n';
      const inputs = Object.keys(workflow.inputs || {});
      if (inputs.length === 0) {
        message += '- No inputs required\n';
      } else {
        inputs.forEach(input => {
          const defaultValue = workflow.inputs[input] || '';
          message += `- \`${input}\`${defaultValue ? ` (default: ${defaultValue})` : ''}\n`;
        });
      }
      
      // Add usage instructions
      message += '\n*Usage Example:*\n';
      message += '```\n/generate ';
      message += workflow.name;
      
      inputs.forEach(input => {
        message += ` ${input}="your ${input}"`;
      });
      
      message += '\n```';
      
      return {
        message,
        type: 'text',
        options: {
          parse_mode: 'Markdown'
        }
      };
    } catch (error) {
      console.error('Error executing workflow command:', error);
      
      return {
        message: 'Sorry, there was an error retrieving workflow details. Please try again later.',
        type: 'text'
      };
    }
  }
}

module.exports = new WorkflowCommand(); 