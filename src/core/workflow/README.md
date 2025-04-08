# Workflow System

## Overview

The Workflow System provides a platform-agnostic framework for managing multi-step interactions in the application. It uses immutable state containers, explicit transitions, and event-based architecture to create maintainable, testable workflows.

## Design Principles

1. **Platform Independence**: Workflows are defined independently of how they'll be rendered
2. **Immutable State**: State transitions are explicit and trackable
3. **Event Driven**: Events are emitted on state changes
4. **Local Instantiation**: Workflow instances are self-contained
5. **Validation First**: Input validation happens before state transitions

## Core Components

### WorkflowState

Extends StateContainer to provide workflow-specific state management:

- Tracks the current step, inputs, and errors
- Manages state transitions between steps
- Validates inputs before accepting them
- Emits events on transitions

### WorkflowStep

Represents a single step in a workflow:

- Defines validation rules for inputs
- Specifies UI requirements (platform-agnostic)
- Determines transitions to other steps
- Processes inputs before transitions

### WorkflowSequence

Defines the structure of a multi-step workflow:

- Registers and validates step definitions
- Creates workflow instances
- Ensures valid transitions between steps
- Provides serialization for persistence

### WorkflowBuilder

Helper factory for creating common workflow patterns:

- Linear workflows (step 1 → step 2 → step 3)
- Form workflows (multiple fields with validation)
- Branching workflows (conditional paths)

## Usage Examples

### Creating a Simple Linear Workflow

```javascript
const { createLinearWorkflow } = require('../core/workflow');

// Define a simple workflow
const signupWorkflow = createLinearWorkflow({
  name: 'UserSignup',
  steps: [
    {
      id: 'email',
      name: 'Email Input',
      validate: (input) => {
        const valid = /^.+@.+\..+$/.test(input);
        return {
          valid,
          errors: valid ? [] : ['Please enter a valid email address']
        };
      },
      ui: {
        type: 'text_input',
        message: 'Enter your email address:'
      }
    },
    {
      id: 'password',
      name: 'Password Input',
      validate: (input) => {
        const valid = input.length >= 8;
        return {
          valid,
          errors: valid ? [] : ['Password must be at least 8 characters']
        };
      },
      ui: {
        type: 'password_input',
        message: 'Create a password:'
      }
    },
    {
      id: 'confirmation',
      name: 'Account Creation',
      process: async (input, workflow) => {
        const { email, password } = workflow.getAllInputs();
        // Process account creation
        return { success: true };
      },
      ui: {
        type: 'confirmation',
        message: 'Creating your account...'
      }
    }
  ]
});

// Create a workflow instance
const workflowInstance = signupWorkflow.createWorkflow({
  userId: 'user123'
});

// Use the workflow
const step1 = workflowInstance.getCurrentStep();
console.log(step1.ui.message); // "Enter your email address:"

// Submit input for the current step
const result = workflowInstance.submitInput('user@example.com');
console.log(result.success); // true
console.log(result.nextStep); // "password"
```

### Creating a Branching Workflow

```javascript
const { createWorkflow, WorkflowStep } = require('../core/workflow');

// Define a workflow with conditional branching
const paymentWorkflow = createWorkflow({
  name: 'PaymentProcess',
  steps: {
    'method': {
      id: 'method',
      name: 'Payment Method Selection',
      transitions: {
        'credit': 'credit_details',
        'paypal': 'paypal_login',
        'crypto': 'crypto_address'
      },
      ui: {
        type: 'options',
        message: 'Select payment method:',
        options: ['credit', 'paypal', 'crypto']
      }
    },
    'credit_details': {
      id: 'credit_details',
      name: 'Credit Card Details',
      nextStep: 'confirmation',
      ui: {
        type: 'form',
        message: 'Enter card details:'
      }
    },
    'paypal_login': {
      id: 'paypal_login',
      name: 'PayPal Login',
      nextStep: 'confirmation',
      ui: {
        type: 'redirect',
        message: 'Redirecting to PayPal...'
      }
    },
    'crypto_address': {
      id: 'crypto_address',
      name: 'Cryptocurrency Address',
      nextStep: 'confirmation',
      ui: {
        type: 'display',
        message: 'Send payment to address:'
      }
    },
    'confirmation': {
      id: 'confirmation',
      name: 'Payment Confirmation',
      nextStep: null,
      ui: {
        type: 'confirmation',
        message: 'Confirming payment...'
      }
    }
  },
  initialStep: 'method'
});
```

## Integration with Sessions

The workflow system is designed to work with the SessionManager:

```javascript
// Store a workflow in a user's session
async function storeWorkflow(sessionManager, userId, workflow) {
  await sessionManager.updateSession(userId, {
    [`workflows.${workflow.context.workflowId}`]: workflow.serialize()
  });
}

// Retrieve a workflow from a user's session
async function retrieveWorkflow(sessionManager, userId, workflowId, workflowSequence) {
  const session = await sessionManager.getSession(userId);
  const serialized = session.get(`workflows.${workflowId}`);
  
  if (!serialized) {
    return null;
  }
  
  return WorkflowState.deserialize(serialized, workflowSequence.getAllSteps());
}
```

## Event Handling

Workflows emit events that can be used for monitoring and integration:

- `workflow:started` - When a workflow is created
- `workflow:step_changed` - When transitioning to a new step
- `workflow:step_jumped` - When explicitly jumping to a step
- `workflow:completed` - When a workflow reaches completion

## Best Practices

1. **Keep Steps Focused**: Each step should represent a single interaction
2. **Validate Early**: Add validation to prevent invalid state transitions
3. **Use Context**: Store workflow-specific data in the context
4. **Handle Errors**: Add proper error handling for validation failures
5. **Serialize for Persistence**: Store workflows in sessions for long-running interactions 