/**
 * Account Commands Core Implementation
 * 
 * Platform-agnostic implementation of account-related commands
 * such as profile management, preferences, API keys, and points management
 * 
 * This implementation follows the clean architecture pattern and uses
 * the workflow system for complex interactions.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { createAccountWorkflow } = require('../workflow/workflows/AccountWorkflow');

/**
 * Handler for the account command
 * 
 * @param {Object} context - Command execution context
 * @returns {Promise<Object>} Command execution result
 */
async function accountCommandHandler(context) {
  const {
    userId,
    platform,
    sessionManager,
    uiManager,
    accountService,
    pointsService,
    analyticsService,
    workflowEngine,
    parameters = {},
    messageContext = {},
    operationType
  } = context;

  if (!userId) {
    throw new AppError('User ID is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_USER_ID',
      userFacing: true
    });
  }

  if (!accountService) {
    throw new AppError('Account service is required', {
      severity: ERROR_SEVERITY.ERROR,
      code: 'MISSING_ACCOUNT_SERVICE'
    });
  }

  try {
    // Track command usage
    analyticsService?.trackEvent('command:account:initiated', {
      userId,
      platform,
      operationType,
      timestamp: Date.now()
    });

    // Get user's session if available
    let userSession;
    if (sessionManager) {
      userSession = await sessionManager.getSession(userId);
      if (!userSession) {
        // Create a new session if none exists
        userSession = await sessionManager.createSession(userId, {
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
      } else {
        // Update existing session
        await sessionManager.updateSession(userId, {
          lastActivity: Date.now(),
          lastCommand: operationType || 'account'
        });
      }
    }

    // Create the workflow options
    const workflowOptions = {
      accountService,
      pointsService,
      analyticsService,
      deliveryAdapter: createPlatformDeliveryAdapter(platform, uiManager, messageContext)
    };

    // Create the workflow
    const workflow = createAccountWorkflow(workflowOptions);

    // Initialize the workflow state with user context
    const initialState = {
      userId,
      platform,
      operationType: operationType || 'account',
      username: messageContext.username || userSession?.get('username'),
      chatId: messageContext.chatId,
      threadId: messageContext.threadId,
      locale: messageContext.locale || userSession?.get('locale') || 'en',
      workflowId: parameters.workflowId || `account-${userId}-${Date.now()}`,
      startedAt: Date.now(),
      platformContext: messageContext
    };

    // Start the workflow using the WorkflowEngine if available
    if (workflowEngine) {
      const startedWorkflow = await workflowEngine.startWorkflow('AccountWorkflow', initialState, workflow);
      
      // Return information about the started workflow
      return {
        success: true,
        message: `${operationType || 'account'} workflow started`,
        workflowId: startedWorkflow.id,
        initialStep: startedWorkflow.currentStep
      };
    }

    // Fallback to manual workflow initialization if no WorkflowEngine
    const workflowInstance = workflow.createWorkflow({
      context: initialState
    });

    // Process specific operation type if provided
    if (operationType && operationType !== 'account') {
      await workflowInstance.processInput(operationType);
    }

    // Render the current step UI
    const currentStep = workflowInstance.getCurrentStep();
    
    if (!currentStep) {
      throw new AppError('Failed to initialize workflow', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WORKFLOW_INIT_FAILED',
        userFacing: true
      });
    }

    // Extract UI definition from the current step
    const uiDefinition = currentStep.ui || {};

    // Create platform-specific context for UI rendering
    const renderContext = {
      chatId: messageContext.chatId,
      threadId: messageContext.threadId,
      messageId: messageContext.messageId,
      workflowId: workflowInstance.id,
      stepId: currentStep.id
    };

    // Render the UI component
    const renderResult = await renderStepUI(uiManager, platform, uiDefinition, renderContext);

    // Store the workflow in the user's session
    if (sessionManager) {
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowInstance.id]: workflowInstance.serialize()
        }
      });
    }

    // Return information about the started workflow
    return {
      success: true,
      message: `${operationType || 'account'} workflow started`,
      workflowId: workflowInstance.id,
      uiRendered: !!renderResult,
      initialStep: currentStep.id
    };
  } catch (error) {
    // Track error
    analyticsService?.trackEvent('command:account:error', {
      userId,
      platform,
      operationType: operationType || 'account',
      error: error.message,
      code: error.code,
      timestamp: Date.now()
    });

    // Handle error based on severity
    if (error.severity === ERROR_SEVERITY.WARNING) {
      // For warnings, return a user-friendly error
      return {
        success: false,
        message: error.userFacing ? error.message : `Could not access account settings`,
        error: error.message,
        code: error.code
      };
    }

    // For critical errors, rethrow for the command router to handle
    throw error;
  }
}

/**
 * Create a platform-specific delivery adapter
 * @private
 * @param {string} platform - Platform identifier
 * @param {Object} uiManager - UI Manager instance
 * @param {Object} messageContext - Message context for delivery
 * @returns {Object} Delivery adapter
 */
function createPlatformDeliveryAdapter(platform, uiManager, messageContext) {
  return {
    deliverMessage: async ({ userId, message, menu, context }) => {
      try {
        // Create a message component
        const component = uiManager.createComponent('message', {
          text: message,
          menu,
          context
        });

        // Render the component on the specified platform
        const renderContext = {
          chatId: messageContext.chatId,
          threadId: messageContext.threadId,
          userId
        };

        return await uiManager.render(component, {}, platform, renderContext);
      } catch (error) {
        console.error('Error delivering message:', error);
        return false;
      }
    }
  };
}

/**
 * Render the UI for a workflow step
 * @private
 * @param {Object} uiManager - UI Manager instance
 * @param {string} platform - Platform identifier
 * @param {Object} uiDefinition - UI definition from workflow step
 * @param {Object} context - Rendering context
 * @returns {Promise<Object>} Rendering result
 */
async function renderStepUI(uiManager, platform, uiDefinition, context) {
  if (!uiManager || !uiDefinition) {
    return null;
  }

  try {
    // Create UI component from definition
    const component = uiManager.createComponentFromDefinition(uiDefinition);
    
    // Render the component
    return await uiManager.render(component, {}, platform, context);
  } catch (error) {
    console.error('Error rendering step UI:', error);
    return null;
  }
}

/**
 * Platform-agnostic account command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createAccountCommand(dependencies = {}) {
  return {
    name: 'account',
    description: 'Manage your account settings',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'account',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Extract workflow ID from context
      const { workflowId } = context;
      
      if (!workflowId) {
        // Start a new workflow if none exists
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      // Get the existing workflow
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        // Workflow not found or expired, start a new one
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      // Restore the workflow
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      // Process the input
      await workflow.processInput(input);
      
      // Store updated workflow state
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowId]: workflow.serialize()
        }
      });
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep().id
      };
    }
  };
}

/**
 * Platform-agnostic points command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createPointsCommand(dependencies = {}) {
  return {
    name: 'points',
    description: 'Check your points balance and history',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'points',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Input handling for points command is similar to account command
      const { workflowId } = context;
      
      if (!workflowId) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      await workflow.processInput(input);
      
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowId]: workflow.serialize()
        }
      });
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep().id
      };
    }
  };
}

/**
 * Platform-agnostic API keys command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createApiKeysCommand(dependencies = {}) {
  return {
    name: 'apikeys',
    description: 'Manage your API keys',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'apikeys',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Input handling for API keys command
      const { workflowId } = context;
      
      if (!workflowId) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      await workflow.processInput(input);
      
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowId]: workflow.serialize()
        }
      });
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep().id
      };
    }
  };
}

/**
 * Platform-agnostic profile command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createProfileCommand(dependencies = {}) {
  return {
    name: 'profile',
    description: 'Manage your profile settings',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'profile',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Similar input handling pattern
      const { workflowId } = context;
      
      if (!workflowId) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      await workflow.processInput(input);
      
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowId]: workflow.serialize()
        }
      });
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep().id
      };
    }
  };
}

/**
 * Platform-agnostic preferences command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createPreferencesCommand(dependencies = {}) {
  return {
    name: 'preferences',
    description: 'Manage your account preferences',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'preferences',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Similar input handling pattern
      const { workflowId } = context;
      
      if (!workflowId) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      await workflow.processInput(input);
      
      await sessionManager.updateSession(userId, {
        workflows: {
          [workflowId]: workflow.serialize()
        }
      });
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep().id
      };
    }
  };
}

/**
 * Platform-agnostic delete account command implementation
 * @public
 * @param {Object} dependencies - Injectable dependencies
 * @returns {Object} Command implementation
 */
function createDeleteAccountCommand(dependencies = {}) {
  return {
    name: 'delete',
    description: 'Delete your account',
    
    async execute(context) {
      return accountCommandHandler({
        ...context,
        operationType: 'delete',
        ...dependencies
      });
    },
    
    async handleInput(input, context) {
      // Similar input handling pattern with special care for delete confirmation
      const { workflowId } = context;
      
      if (!workflowId) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { sessionManager, userId } = context;
      const session = await sessionManager.getSession(userId);
      const workflowData = session.get(`workflows.${workflowId}`);
      
      if (!workflowData) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      const { workflowEngine } = dependencies;
      const workflow = await workflowEngine.getWorkflow(workflowId);
      
      if (!workflow) {
        return this.execute({
          ...context,
          parameters: { input }
        });
      }
      
      await workflow.processInput(input);
      
      // If the workflow completes with delete confirmation
      if (workflow.isCompleted() && workflow.getResult()?.confirmed === true) {
        const { accountService } = dependencies;
        await accountService.deleteUserAccount(userId);
        
        // Clear the session
        await sessionManager.endSession(userId);
        
        return {
          success: true,
          message: 'Account deleted successfully',
          accountDeleted: true
        };
      }
      
      // Store updated workflow state if not completed
      if (!workflow.isCompleted()) {
        await sessionManager.updateSession(userId, {
          workflows: {
            [workflowId]: workflow.serialize()
          }
        });
      }
      
      return {
        success: true,
        message: 'Input processed',
        workflowId,
        currentStep: workflow.getCurrentStep()?.id || 'completed',
        completed: workflow.isCompleted()
      };
    }
  };
}

/**
 * Register account-related commands with the command registry
 * @public
 * @param {Object} registry - Command registry
 * @param {Object} dependencies - Injectable dependencies
 */
function registerAccountCommands(registry, dependencies = {}) {
  if (!registry) {
    throw new Error('Command registry is required');
  }
  
  const accountCommand = createAccountCommand(dependencies);
  const pointsCommand = createPointsCommand(dependencies);
  const apiKeysCommand = createApiKeysCommand(dependencies);
  const profileCommand = createProfileCommand(dependencies);
  const preferencesCommand = createPreferencesCommand(dependencies);
  const deleteAccountCommand = createDeleteAccountCommand(dependencies);
  
  // Register main commands
  registry.register(accountCommand);
  registry.register(pointsCommand);
  
  // Register subcommands
  registry.registerSubcommand('account', profileCommand);
  registry.registerSubcommand('account', preferencesCommand);
  registry.registerSubcommand('account', apiKeysCommand);
  registry.registerSubcommand('account', deleteAccountCommand);
}

module.exports = {
  accountCommandHandler,
  createAccountCommand,
  createPointsCommand,
  createApiKeysCommand,
  createProfileCommand,
  createPreferencesCommand,
  createDeleteAccountCommand,
  registerAccountCommands
}; 