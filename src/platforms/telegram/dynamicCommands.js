const { sanitizeCommandName } = require('../../utils/stringUtils');

async function setupDynamicCommands(bot, workflows) {
    console.log('Setting up dynamic commands...');
    console.log('workflows in setupDynamicCommands', workflows);
  try {
    // Get workflows from the service
    // First check if we have access to the workflows
    if (!workflows) {
      console.warn('Workflows service not available for dynamic commands');
      return;
    }

    // Debug log to understand what methods are available
    console.log('Available workflow methods:', Object.keys(workflows));

    // Get workflows using the available interface
    // Assuming workflows are stored in the service instance
    //const workflows = workflows.workflows || [];
    
    if (!workflows.length) {
      console.warn('No workflows found for dynamic commands');
      return;
    }

    console.log(`Found ${workflows.length} workflows to process`);

    // Filter for text-only workflows (no input_image)
    const textOnlyWorkflows = workflows.filter(workflow => {
      const inputs = workflow.inputs || {};
      return !inputs.input_image && inputs.input_prompt;
    });

    console.log(`Found ${textOnlyWorkflows.length} text-only workflows`);

    // Register each workflow as a command
    textOnlyWorkflows.forEach(workflow => {
      const commandName = sanitizeCommandName(workflow.name);
      console.log(`Registering command: /${commandName}`);

      bot.command(commandName, async (ctx) => {
        try {
          const userId = ctx.from.id;
          const username = ctx.from.username;
          
          const prompt = ctx.message.text.split(' ').slice(1).join(' ');
          
          if (!prompt) {
            return ctx.reply(`Please provide a prompt. Usage: /${commandName} your prompt here`);
          }

          // Use the workflow execution method from services
          const result = await workflows.execute({
            workflowId: workflow.id,
            userId,
            username,
            inputs: {
              input_prompt: prompt
            }
          });

          if (result.error) {
            return ctx.reply(`Error: ${result.error}`);
          }

          if (result.outputUrl) {
            return ctx.replyWithPhoto(result.outputUrl);
          }

          ctx.reply('Workflow completed successfully!');
        } catch (error) {
          console.error(`Error executing workflow ${commandName}:`, error);
          ctx.reply(`Error executing workflow: ${error.message}`);
        }
      });
    });

    console.log('Dynamic commands setup completed');

  } catch (error) {
    console.error('Failed to setup dynamic commands:', error);
    throw error; // Re-throw to handle in the platform initialization
  }
}

module.exports = { setupDynamicCommands };