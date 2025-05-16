/**
 * LoRA Training Workflow Example
 * 
 * This example demonstrates how to create a more complex workflow for LoRA training
 * using the local state instantiation pattern similar to iTrain.js. It shows how
 * to manage a non-linear multi-step interaction with rich context.
 */

const { createWorkflow } = require('../index');
const crypto = require('crypto');

/**
 * Generate a unique identifier for a LoRA
 * @returns {string} Generated ID
 */
function generateLoraId() {
  return 'lora_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Validate LoRA name
 * @param {string} input - User input name
 * @returns {Object} Validation result
 */
function validateLoraName(input) {
  if (!input || typeof input !== 'string') {
    return {
      valid: false,
      errors: ['Name must be a non-empty string']
    };
  }
  
  if (input.length < 3) {
    return {
      valid: false,
      errors: ['Name must be at least 3 characters']
    };
  }
  
  if (input.length > 50) {
    return {
      valid: false,
      errors: ['Name exceeds maximum length of 50 characters']
    };
  }
  
  // Check for invalid characters
  if (!/^[a-zA-Z0-9_\- ]+$/.test(input)) {
    return {
      valid: false,
      errors: ['Name contains invalid characters. Use only letters, numbers, spaces, hyphens, and underscores.']
    };
  }
  
  return { valid: true };
}

/**
 * Process a new LoRA creation
 * @param {string} input - LoRA name
 * @param {Object} workflow - Workflow state
 * @returns {Object} Process result
 */
function processLoraCreation(input, workflow) {
  // In a real implementation, this would create an entry in the database
  const loraId = generateLoraId();
  
  // Update the workflow context with the new LoRA data
  const loraData = {
    loraId,
    name: input,
    userId: workflow.context.userId,
    images: new Array(20).fill(''),
    captions: new Array(20).fill(''),
    initiated: Date.now(),
    status: 'incomplete',
    version: '1.0',
    locked: false
  };
  
  // Return the processed data
  return loraData;
}

/**
 * Process image upload for a slot
 * @param {Object} input - Image data with slot index
 * @param {Object} workflow - Workflow state
 * @returns {Object} Updated images array
 */
function processImageUpload(input, workflow) {
  const { slotIndex, imageUrl } = input;
  const state = workflow.getState();
  const loraData = state.loraData || {};
  
  // Make a copy of the images array
  const images = [...(loraData.images || new Array(20).fill(''))];
  
  // Update the image at the specified slot
  images[slotIndex] = imageUrl;
  
  return images;
}

/**
 * Determine if we have enough images to proceed
 * @param {Object} workflow - Workflow state
 * @returns {boolean} True if ready to proceed
 */
function hasEnoughImages(workflow) {
  const state = workflow.getState();
  const images = state.loraData?.images || [];
  return images.filter(Boolean).length >= 4;
}

/**
 * Transition based on image count
 * @param {Object} input - Input
 * @param {Object} workflow - Workflow state
 * @returns {string} Next step ID
 */
function imageStepTransition(input, workflow) {
  return hasEnoughImages(workflow) ? 'captions' : 'images';
}

/**
 * Check if the user can proceed to training
 * @param {Object} workflow - Workflow state
 * @returns {boolean} True if ready to train
 */
function isReadyToTrain(workflow) {
  const state = workflow.getState();
  const loraData = state.loraData || {};
  const images = loraData.images || [];
  const captions = loraData.captions || [];
  
  // Check if we have at least 4 images with captions
  let validPairs = 0;
  for (let i = 0; i < images.length; i++) {
    if (images[i] && captions[i]) {
      validPairs++;
    }
  }
  
  return validPairs >= 4;
}

/**
 * Create a LoRA training workflow
 * @returns {Object} Workflow sequence
 */
function createLoraTrainingWorkflow() {
  return createWorkflow({
    name: 'LoRATraining',
    steps: {
      'name': {
        id: 'name',
        name: 'LoRA Name',
        validate: validateLoraName,
        process: processLoraCreation,
        nextStep: 'images',
        ui: {
          type: 'text_input',
          message: 'What is the name of the LoRA?',
          placeholder: 'Enter a name for your LoRA'
        }
      },
      'images': {
        id: 'images',
        name: 'Training Images',
        validate: (input) => {
          // Basic validation for image upload
          if (!input || !input.imageUrl) {
            return {
              valid: false,
              errors: ['Image data is required']
            };
          }
          return { valid: true };
        },
        process: processImageUpload,
        // Dynamic transition based on image count
        transitions: imageStepTransition,
        ui: {
          type: 'image_upload',
          message: 'Upload training images (minimum 4)',
          description: 'Select images that represent what you want to train'
        }
      },
      'captions': {
        id: 'captions',
        name: 'Image Captions',
        validate: (input) => {
          // Basic validation for caption input
          if (!input || !input.caption || !input.slotIndex) {
            return {
              valid: false,
              errors: ['Caption and slot index are required']
            };
          }
          return { valid: true };
        },
        process: (input, workflow) => {
          const { slotIndex, caption } = input;
          const state = workflow.getState();
          const loraData = state.loraData || {};
          
          // Make a copy of the captions array
          const captions = [...(loraData.captions || new Array(20).fill(''))];
          
          // Update the caption at the specified slot
          captions[slotIndex] = caption;
          
          return captions;
        },
        // Can move forward to training config or back to images
        transitions: (input, workflow) => {
          if (input === 'back') return 'images';
          return isReadyToTrain(workflow) ? 'training_config' : 'captions';
        },
        ui: {
          type: 'caption_editor',
          message: 'Add captions to your images',
          description: 'Describe each image with relevant details'
        }
      },
      'training_config': {
        id: 'training_config',
        name: 'Training Configuration',
        validate: (input) => ({ valid: true }), // Basic validation
        process: (input, workflow) => {
          // Process training configuration
          return {
            ...input,
            configuredAt: Date.now()
          };
        },
        nextStep: 'confirmation',
        ui: {
          type: 'training_config_form',
          message: 'Configure your training',
          fields: [
            { name: 'epochs', label: 'Epochs', type: 'number', default: 10 },
            { name: 'learning_rate', label: 'Learning Rate', type: 'number', default: 0.0001 },
            { name: 'batch_size', label: 'Batch Size', type: 'number', default: 1 }
          ]
        }
      },
      'confirmation': {
        id: 'confirmation',
        name: 'Training Confirmation',
        process: (input, workflow) => {
          // In a real implementation, this would queue the training job
          return {
            confirmed: true,
            trainJobId: 'job_' + Math.floor(Math.random() * 1000000),
            queuedAt: Date.now()
          };
        },
        nextStep: 'training',
        ui: {
          type: 'confirmation',
          message: 'Start training your LoRA?',
          description: 'This process will take some time to complete'
        }
      },
      'training': {
        id: 'training',
        name: 'Training Progress',
        process: (input, workflow) => {
          // In a real implementation, this would check training progress
          return {
            status: 'training',
            progress: Math.random() * 100,
            updatedAt: Date.now()
          };
        },
        // Allow checking progress multiple times
        nextStep: 'training',
        ui: {
          type: 'progress',
          message: 'Training in progress',
          description: 'Your model is being trained',
          refreshable: true
        }
      },
      'completion': {
        id: 'completion',
        name: 'Training Complete',
        ui: {
          type: 'training_complete',
          message: 'Training complete!',
          description: 'Your LoRA model is ready to use'
        }
      }
    },
    initialStep: 'name',
    metadata: {
      description: 'LoRA training workflow',
      category: 'training',
      version: '1.0.0'
    }
  });
}

/**
 * Example usage with the local state pattern
 */
async function exampleUsage() {
  // Create the workflow
  const trainingWorkflow = createLoraTrainingWorkflow();
  
  // Create a workflow instance for a specific user
  const workflowInstance = trainingWorkflow.createWorkflow({
    userId: 'user123',
    loraData: null, // Will be populated during the workflow
  });
  
  console.log('Starting LoRA training workflow');
  
  // Step 1: Set LoRA name
  console.log(`Current step: ${workflowInstance.getCurrentStep().name}`);
  const nameResult = workflowInstance.submitInput('My Custom Character');
  console.log(`Name input success: ${nameResult.success}`);
  
  // The workflow context now has loraData populated from the process function
  const state = workflowInstance.getState();
  console.log(`Created LoRA with ID: ${state.loraData.loraId}`);
  
  // Step 2: Upload first image
  console.log(`Current step: ${workflowInstance.getCurrentStep().name}`);
  workflowInstance.submitInput({
    slotIndex: 0,
    imageUrl: 'https://example.com/image1.jpg'
  });
  
  // Upload more images to meet the minimum
  for (let i = 1; i < 4; i++) {
    workflowInstance.submitInput({
      slotIndex: i,
      imageUrl: `https://example.com/image${i+1}.jpg`
    });
  }
  
  // Now should automatically transition to captions step
  console.log(`Current step after uploads: ${workflowInstance.getCurrentStep().name}`);
  
  // Step 3: Add captions
  for (let i = 0; i < 4; i++) {
    workflowInstance.submitInput({
      slotIndex: i,
      caption: `Description for image ${i+1}`
    });
  }
  
  // Step 4: Configure training
  workflowInstance.submitInput({
    epochs: 15,
    learning_rate: 0.0002,
    batch_size: 2
  });
  
  // Step 5: Confirm training
  workflowInstance.submitInput(true);
  
  // Check training progress (would refresh in real app)
  const trainingStep = workflowInstance.getCurrentStep();
  console.log(`Current step: ${trainingStep.name}`);
  
  // Manually jump to completion for this example
  workflowInstance.jumpToStep('completion');
  
  return workflowInstance;
}

// Allow this to be required or run directly
if (require.main === module) {
  exampleUsage()
    .then(workflow => {
      console.log('Workflow completed successfully');
      // Only log important parts of state to avoid too much output
      const state = workflow.getState();
      console.log('LoRA data:', {
        loraId: state.loraData.loraId,
        name: state.loraData.name,
        imageCount: state.loraData.images.filter(Boolean).length,
        captionCount: state.loraData.captions.filter(Boolean).length,
        status: state.loraData.status
      });
    })
    .catch(error => {
      console.error('Workflow error:', error);
    });
}

module.exports = {
  createLoraTrainingWorkflow,
  validateLoraName,
  processLoraCreation,
  generateLoraId
}; 