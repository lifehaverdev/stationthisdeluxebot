/**
 * ComfyDeploy Media Service
 * 
 * Provides media processing operations using ComfyDeploy
 */

const ComfyDeployClient = require('./client');
const ComfyDeployMapper = require('./mapper');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');

/**
 * ComfyDeploy Media Service
 * Provides methods for image-to-image, background removal, upscaling, etc.
 */
class ComfyDeployMediaService {
  /**
   * @param {Object} options - Service options
   * @param {Array} options.workflows - Available workflow definitions
   * @param {string} [options.apiKey] - ComfyDeploy API key (falls back to env var)
   * @param {string} [options.webhookUrl] - Webhook URL for callbacks
   */
  constructor(options = {}) {
    this.client = new ComfyDeployClient({
      apiKey: options.apiKey,
      webhookUrl: options.webhookUrl || config.getWebhookUrl()
    });
    
    this.mapper = new ComfyDeployMapper();
    this.workflows = options.workflows || [];
  }

  /**
   * Process image-to-image generation
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.prompt - Generation prompt
   * @param {string} params.imageUrl - Source image URL
   * @param {Object} [params.settings] - Additional settings
   * @param {Object} [params.metadata] - Additional metadata
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async processImageToImage(params) {
    try {
      const { userId, prompt, imageUrl, settings = {}, metadata = {} } = params;
      
      // Get deployment info for I2I
      const deploymentInfo = config.getDeploymentInfo('I2I', this.workflows);
      
      // Prepare inputs
      const inputs = {
        prompt: prompt,
        negative_prompt: settings.negativePrompt || config.getDefaultNegativePrompt(),
        image: imageUrl,
        width: settings.width || 1024,
        height: settings.height || 1024,
        strength: settings.strength || 0.75,
        steps: settings.steps || 30,
        cfg_scale: settings.cfg || 7,
        seed: settings.seed || -1,
        batch_size: settings.batch || 1,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'image-to-image'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'image-to-image'
      };
    } catch (error) {
      console.error('Error processing image-to-image:', error);
      throw error;
    }
  }

  /**
   * Remove background from image
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.imageUrl - Source image URL
   * @param {Object} [params.settings] - Additional settings
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async removeBackground(params) {
    try {
      const { userId, imageUrl, settings = {} } = params;
      
      // Get deployment info for RMBG
      const deploymentInfo = config.getDeploymentInfo('RMBG', this.workflows);
      
      // Prepare inputs
      const inputs = {
        image: imageUrl,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'background-removal'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'background-removal'
      };
    } catch (error) {
      console.error('Error removing background:', error);
      throw error;
    }
  }

  /**
   * Upscale image
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.imageUrl - Source image URL
   * @param {Object} [params.settings] - Additional settings
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async upscaleImage(params) {
    try {
      const { userId, imageUrl, settings = {} } = params;
      
      // Get deployment info for UPSCALE
      const deploymentInfo = config.getDeploymentInfo('UPSCALE', this.workflows);
      
      // Prepare inputs
      const inputs = {
        image: imageUrl,
        scale: settings.scale || 2,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'upscale'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'upscale'
      };
    } catch (error) {
      console.error('Error upscaling image:', error);
      throw error;
    }
  }

  /**
   * Analyze image content (interrogate)
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.imageUrl - Source image URL
   * @param {Object} [params.settings] - Additional settings
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async interrogateImage(params) {
    try {
      const { userId, imageUrl, settings = {} } = params;
      
      // Get deployment info for INTERROGATE
      const deploymentInfo = config.getDeploymentInfo('INTERROGATE', this.workflows);
      
      // Prepare inputs
      const inputs = {
        image: imageUrl,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'interrogate'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'interrogate'
      };
    } catch (error) {
      console.error('Error interrogating image:', error);
      throw error;
    }
  }

  /**
   * Generate animation from image
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.prompt - Generation prompt
   * @param {string} params.imageUrl - Source image URL
   * @param {Object} [params.settings] - Additional settings
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async animateImage(params) {
    try {
      const { userId, prompt, imageUrl, settings = {} } = params;
      
      // Get deployment info for ANIMATE
      const deploymentInfo = config.getDeploymentInfo('ANIMATE', this.workflows);
      
      // Prepare inputs
      const inputs = {
        prompt: prompt,
        negative_prompt: settings.negativePrompt || config.getDefaultNegativePrompt(),
        image: imageUrl,
        frames: settings.frames || 16,
        fps: settings.fps || 8,
        motion_scale: settings.motionScale || 1.0,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'animate'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'animate'
      };
    } catch (error) {
      console.error('Error animating image:', error);
      throw error;
    }
  }

  /**
   * Generate video from prompt
   * @param {Object} params - Processing parameters
   * @param {string} params.userId - User ID
   * @param {string} params.prompt - Generation prompt
   * @param {Object} [params.settings] - Additional settings
   * @returns {Promise<Object>} - Processing result with run_id
   */
  async generateVideo(params) {
    try {
      const { userId, prompt, settings = {} } = params;
      
      // Get deployment info for VIDEO
      const deploymentInfo = config.getDeploymentInfo('VIDEO', this.workflows);
      
      // Prepare inputs
      const inputs = {
        prompt: prompt,
        negative_prompt: settings.negativePrompt || config.getDefaultNegativePrompt(),
        width: settings.width || 512,
        height: settings.height || 512,
        frames: settings.frames || 24,
        fps: settings.fps || 8,
        ...settings
      };
      
      // Generate using ComfyDeploy client
      const taskId = uuidv4();
      const response = await this.client.generate({
        deployment_id: deploymentInfo.ids[0],
        inputs,
        webhook_url: params.callbackUrl,
        webhook_data: {
          taskId,
          userId,
          operation: 'video'
        }
      });
      
      return {
        taskId,
        run_id: response.run_id,
        status: 'queued',
        operation: 'video'
      };
    } catch (error) {
      console.error('Error generating video:', error);
      throw error;
    }
  }

  /**
   * Check status of a media processing operation
   * @param {Object} params - Status check parameters
   * @param {string} params.run_id - ComfyDeploy run ID
   * @param {string} params.taskId - Internal task ID
   * @param {string} params.userId - User ID
   * @returns {Promise<Object>} - Status information with processed outputs
   */
  async checkStatus(params) {
    try {
      const { run_id, taskId, userId } = params;
      
      // Get status from ComfyDeploy
      const response = await this.client.getStatus(run_id);
      
      // Check if processing is complete
      if (response.status === 'success' || response.status === 'failed') {
        return {
          taskId,
          run_id,
          status: response.status,
          outputs: response.output.outputs,
          complete: true
        };
      }
      
      // Return progress information for in-progress tasks
      return {
        taskId,
        run_id,
        status: response.status,
        progress: response.progress,
        complete: false
      };
    } catch (error) {
      console.error('Error checking media processing status:', error);
      throw error;
    }
  }
}

module.exports = ComfyDeployMediaService; 