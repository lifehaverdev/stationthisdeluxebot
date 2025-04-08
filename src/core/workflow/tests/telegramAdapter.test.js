/**
 * Tests for Telegram Adapter
 */

const { WorkflowState, WorkflowStep } = require('../state');
const { renderStep, processCallbackQuery, processMessage } = require('../adapters/telegramAdapter');

// Mock Telegram Bot
const mockBot = {
  sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
  sendPhoto: jest.fn().mockResolvedValue({ message_id: 124 }),
  editMessageText: jest.fn().mockResolvedValue(true),
  editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
  editMessageCaption: jest.fn().mockResolvedValue(true)
};

describe('Telegram Adapter', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // Mock workflow state and steps
  const createTextInputWorkflow = () => {
    const steps = {
      'input': new WorkflowStep({
        id: 'input',
        name: 'Text Input',
        nextStep: 'result',
        ui: {
          type: 'text_input',
          text: 'Please enter some text',
          placeholder: 'Your text here'
        },
        validate: (input) => {
          if (!input || input.length < 3) {
            return { valid: false, error: 'Text must be at least 3 characters' };
          }
          return { valid: true };
        }
      }),
      'result': new WorkflowStep({
        id: 'result',
        name: 'Result',
        nextStep: null,
        ui: {
          type: 'result',
          text: 'Your text: {{input}}'
        }
      })
    };
    
    return new WorkflowState({
      id: 'text-input-workflow',
      name: 'Text Input Workflow',
      steps,
      startStep: 'input',
      data: {}
    });
  };
  
  const createOptionsWorkflow = () => {
    const steps = {
      'options': new WorkflowStep({
        id: 'options',
        name: 'Select Option',
        nextStep: 'result',
        ui: {
          type: 'options',
          text: 'Please select an option',
          options: [
            { label: 'Option 1', value: 'opt1' },
            { label: 'Option 2', value: 'opt2' },
            { label: 'Option 3', value: 'opt3' }
          ]
        }
      }),
      'result': new WorkflowStep({
        id: 'result',
        name: 'Result',
        nextStep: null,
        ui: {
          type: 'result',
          text: 'Selected: {{options}}'
        }
      })
    };
    
    return new WorkflowState({
      id: 'options-workflow',
      name: 'Options Workflow',
      steps,
      startStep: 'options',
      data: {}
    });
  };
  
  const createImageUploadWorkflow = () => {
    const steps = {
      'upload': new WorkflowStep({
        id: 'upload',
        name: 'Upload Image',
        nextStep: 'caption',
        ui: {
          type: 'image_upload',
          text: 'Please upload an image'
        }
      }),
      'caption': new WorkflowStep({
        id: 'caption',
        name: 'Add Caption',
        nextStep: 'result',
        ui: {
          type: 'caption_editor',
          text: 'Add a caption to your image'
        }
      }),
      'result': new WorkflowStep({
        id: 'result',
        name: 'Result',
        nextStep: null,
        ui: {
          type: 'result',
          text: 'Image uploaded with caption: {{caption}}'
        }
      })
    };
    
    return new WorkflowState({
      id: 'image-upload-workflow',
      name: 'Image Upload Workflow',
      steps,
      startStep: 'upload',
      data: {}
    });
  };
  
  const createConfirmationWorkflow = () => {
    const steps = {
      'confirm': new WorkflowStep({
        id: 'confirm',
        name: 'Confirm Action',
        nextStep: 'result',
        ui: {
          type: 'confirmation',
          text: 'Are you sure you want to proceed?',
          confirmLabel: 'Yes, proceed',
          cancelLabel: 'No, cancel'
        }
      }),
      'result': new WorkflowStep({
        id: 'result',
        name: 'Result',
        nextStep: null,
        ui: {
          type: 'result',
          text: 'Confirmation: {{confirm}}'
        }
      })
    };
    
    return new WorkflowState({
      id: 'confirmation-workflow',
      name: 'Confirmation Workflow',
      steps,
      startStep: 'confirm',
      data: {}
    });
  };
  
  const createProgressWorkflow = () => {
    const steps = {
      'progress': new WorkflowStep({
        id: 'progress',
        name: 'Progress',
        nextStep: 'result',
        ui: {
          type: 'progress',
          text: 'Processing your request...',
          progressKey: 'taskProgress'
        }
      }),
      'result': new WorkflowStep({
        id: 'result',
        name: 'Result',
        nextStep: null,
        ui: {
          type: 'result',
          text: 'Process completed!'
        }
      })
    };
    
    const workflow = new WorkflowState({
      id: 'progress-workflow',
      name: 'Progress Workflow',
      steps,
      startStep: 'progress',
      data: {},
      context: {
        taskProgress: 50 // Initial progress value
      }
    });
    
    return workflow;
  };
  
  describe('renderStep', () => {
    test('should render text input step', async () => {
      const workflow = createTextInputWorkflow();
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Please enter some text'),
        expect.objectContaining({
          parse_mode: 'HTML'
        })
      );
    });
    
    test('should render options step with inline keyboard', async () => {
      const workflow = createOptionsWorkflow();
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Please select an option'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: 'Option 1',
                  callback_data: expect.stringContaining('opt1')
                })
              ])
            ])
          })
        })
      );
    });
    
    test('should render image upload step', async () => {
      const workflow = createImageUploadWorkflow();
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Please upload an image'),
        expect.any(Object)
      );
    });
    
    test('should render confirmation step with confirm/cancel buttons', async () => {
      const workflow = createConfirmationWorkflow();
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Are you sure you want to proceed?'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  text: 'Yes, proceed',
                  callback_data: expect.stringContaining('confirm:true')
                }),
                expect.objectContaining({
                  text: 'No, cancel',
                  callback_data: expect.stringContaining('confirm:false')
                })
              ])
            ])
          })
        })
      );
    });
    
    test('should render progress step with current progress', async () => {
      const workflow = createProgressWorkflow();
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Processing your request'),
        expect.objectContaining({
          parse_mode: 'HTML'
        })
      );
      
      // Check the message contains the progress percentage
      expect(mockBot.sendMessage.mock.calls[0][1]).toContain('50%');
    });
    
    test('should render result step with interpolated values', async () => {
      const workflow = createTextInputWorkflow();
      workflow.data.input = 'test input';
      workflow.moveToNextStep();
      
      const chatId = 123456;
      
      await renderStep(mockBot, chatId, workflow.getCurrentStep(), workflow);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Your text: test input'),
        expect.any(Object)
      );
    });
  });
  
  describe('processCallbackQuery', () => {
    test('should process option selection callback query', async () => {
      const workflow = createOptionsWorkflow();
      
      const callbackQuery = {
        id: 'callback123',
        from: { id: 'test-user' },
        message: { chat: { id: 123456 }, message_id: 789 },
        data: 'wf_action:options-workflow:options:selection:opt2'
      };
      
      const result = await processCallbackQuery(mockBot, callbackQuery, workflow);
      
      expect(result.handled).toBe(true);
      expect(workflow.data.options).toBe('opt2');
      expect(workflow.currentStep).toBe('result');
      expect(mockBot.editMessageReplyMarkup).toHaveBeenCalled();
    });
    
    test('should process confirmation callback query', async () => {
      const workflow = createConfirmationWorkflow();
      
      const callbackQuery = {
        id: 'callback123',
        from: { id: 'test-user' },
        message: { chat: { id: 123456 }, message_id: 789 },
        data: 'wf_action:confirmation-workflow:confirm:confirm:true'
      };
      
      const result = await processCallbackQuery(mockBot, callbackQuery, workflow);
      
      expect(result.handled).toBe(true);
      expect(workflow.data.confirm).toBe(true);
      expect(workflow.currentStep).toBe('result');
      expect(mockBot.editMessageReplyMarkup).toHaveBeenCalled();
    });
    
    test('should not handle unrelated callback queries', async () => {
      const workflow = createOptionsWorkflow();
      
      const callbackQuery = {
        id: 'callback123',
        from: { id: 'test-user' },
        message: { chat: { id: 123456 }, message_id: 789 },
        data: 'some_other_action:data'
      };
      
      const result = await processCallbackQuery(mockBot, callbackQuery, workflow);
      
      expect(result.handled).toBe(false);
    });
  });
  
  describe('processMessage', () => {
    test('should process text input message', async () => {
      const workflow = createTextInputWorkflow();
      
      const message = {
        from: { id: 'test-user' },
        chat: { id: 123456 },
        text: 'sample text'
      };
      
      const result = await processMessage(mockBot, message, workflow);
      
      expect(result.handled).toBe(true);
      expect(workflow.data.input).toBe('sample text');
      expect(workflow.currentStep).toBe('result');
    });
    
    test('should handle validation errors for text input', async () => {
      const workflow = createTextInputWorkflow();
      
      const message = {
        from: { id: 'test-user' },
        chat: { id: 123456 },
        text: 'ab' // Less than 3 characters, should fail validation
      };
      
      const result = await processMessage(mockBot, message, workflow);
      
      expect(result.handled).toBe(true);
      expect(result.error).toBe('Text must be at least 3 characters');
      expect(workflow.currentStep).toBe('input'); // Should stay on same step
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        123456,
        expect.stringContaining('Text must be at least 3 characters'),
        expect.any(Object)
      );
    });
    
    test('should process image upload message', async () => {
      const workflow = createImageUploadWorkflow();
      
      const message = {
        from: { id: 'test-user' },
        chat: { id: 123456 },
        photo: [
          { file_id: 'small_file_id', width: 100, height: 100 },
          { file_id: 'large_file_id', width: 800, height: 600 }
        ]
      };
      
      const result = await processMessage(mockBot, message, workflow);
      
      expect(result.handled).toBe(true);
      expect(workflow.data.upload).toBe('large_file_id'); // Should pick largest photo
      expect(workflow.currentStep).toBe('caption'); // Should move to caption step
    });
    
    test('should process caption message', async () => {
      const workflow = createImageUploadWorkflow();
      workflow.data.upload = 'photo_file_id';
      workflow.moveToStep('caption'); // Move to caption step
      
      const message = {
        from: { id: 'test-user' },
        chat: { id: 123456 },
        text: 'This is a caption'
      };
      
      const result = await processMessage(mockBot, message, workflow);
      
      expect(result.handled).toBe(true);
      expect(workflow.data.caption).toBe('This is a caption');
      expect(workflow.currentStep).toBe('result');
    });
    
    test('should not handle unrelated messages', async () => {
      const workflow = createOptionsWorkflow(); // Options workflow doesn't handle text input
      
      const message = {
        from: { id: 'test-user' },
        chat: { id: 123456 },
        text: 'some text'
      };
      
      const result = await processMessage(mockBot, message, workflow);
      
      expect(result.handled).toBe(false);
    });
  });
}); 