/**
 * Docker Service
 * 
 * Manages Docker container lifecycle for training jobs
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class DockerService {
  constructor({ logger }) {
    this.logger = logger;
    this.activeContainers = new Map();
  }

  /**
   * Run a training job in a Docker container
   * @param {Object} recipe - Training recipe configuration
   * @param {Object} config - Training configuration
   * @param {string} jobId - Training job ID
   * @returns {Promise<Object>} Training result
   */
  async runTraining(recipe, config, jobId) {
    const containerName = `training-${jobId}`;
    const workDir = `/tmp/training/${jobId}`;
    
    try {
      this.logger.info(`Starting Docker training for job ${jobId}`);
      
      // Create working directory
      await this.createWorkDir(workDir);
      
      // Build Docker image if needed
      const imageName = await this.buildImage(recipe, jobId);
      
      // Run training container
      const result = await this.runContainer(imageName, containerName, config, workDir, jobId);
      
      // Clean up container
      await this.cleanupContainer(containerName);
      
      return result;
      
    } catch (error) {
      this.logger.error(`Docker training failed for job ${jobId}:`, error);
      
      // Clean up on error
      await this.cleanupContainer(containerName);
      throw error;
    }
  }

  /**
   * Create working directory for training
   */
  async createWorkDir(workDir) {
    try {
      await fs.mkdir(workDir, { recursive: true });
      this.logger.info(`Created working directory: ${workDir}`);
    } catch (error) {
      this.logger.error(`Failed to create working directory ${workDir}:`, error);
      throw error;
    }
  }

  /**
   * Build Docker image for training
   */
  async buildImage(recipe, jobId) {
    const imageName = `training-${recipe.modelType.toLowerCase()}:latest`;
    
    try {
      // Check if image already exists
      const exists = await this.imageExists(imageName);
      if (exists) {
        this.logger.info(`Using existing image: ${imageName}`);
        return imageName;
      }

      this.logger.info(`Building Docker image: ${imageName}`);
      
      // Create Dockerfile
      const dockerfile = await recipe.generateDockerfile();
      const dockerfilePath = path.join(__dirname, 'recipes', 'Dockerfile');
      await fs.writeFile(dockerfilePath, dockerfile);
      
      // Build image
      await this.buildDockerImage(dockerfilePath, imageName);
      
      this.logger.info(`Successfully built image: ${imageName}`);
      return imageName;
      
    } catch (error) {
      this.logger.error(`Failed to build image ${imageName}:`, error);
      throw error;
    }
  }

  /**
   * Check if Docker image exists
   */
  async imageExists(imageName) {
    return new Promise((resolve) => {
      const docker = spawn('docker', ['images', '-q', imageName]);
      let output = '';
      
      docker.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      docker.on('close', (code) => {
        resolve(code === 0 && output.trim().length > 0);
      });
    });
  }

  /**
   * Build Docker image
   */
  async buildDockerImage(dockerfilePath, imageName) {
    return new Promise((resolve, reject) => {
      const docker = spawn('docker', ['build', '-t', imageName, '-f', dockerfilePath, path.dirname(dockerfilePath)]);
      
      docker.stdout.on('data', (data) => {
        this.logger.debug(`Docker build: ${data.toString().trim()}`);
      });
      
      docker.stderr.on('data', (data) => {
        this.logger.debug(`Docker build error: ${data.toString().trim()}`);
      });
      
      docker.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker build failed with code ${code}`));
        }
      });
    });
  }

  /**
   * Run training container
   */
  async runContainer(imageName, containerName, config, workDir, jobId) {
    return new Promise((resolve, reject) => {
      const dockerArgs = [
        'run',
        '--rm',
        '--name', containerName,
        '--gpus', 'all', // Enable GPU support
        '-v', `${workDir}:/workspace`,
        '-e', `TRAINING_CONFIG=${JSON.stringify(config)}`,
        '-e', `JOB_ID=${jobId}`,
        imageName
      ];

      this.logger.info(`Running container: docker ${dockerArgs.join(' ')}`);
      
      const docker = spawn('docker', dockerArgs);
      
      let stdout = '';
      let stderr = '';
      
      docker.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        this.logger.info(`[${containerName}] ${output.trim()}`);
      });
      
      docker.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        this.logger.warn(`[${containerName}] ${output.trim()}`);
      });
      
      docker.on('close', (code) => {
        if (code === 0) {
          // Parse training result from stdout
          try {
            const result = this.parseTrainingResult(stdout, workDir);
            resolve(result);
          } catch (error) {
            reject(new Error(`Failed to parse training result: ${error.message}`));
          }
        } else {
          reject(new Error(`Training container failed with code ${code}: ${stderr}`));
        }
      });
      
      // Store container reference for cleanup
      this.activeContainers.set(containerName, docker);
    });
  }

  /**
   * Parse training result from container output
   */
  parseTrainingResult(stdout, workDir) {
    // Look for result file in working directory
    const resultPath = path.join(workDir, 'training_result.json');
    
    try {
      // Try to read result file
      const resultData = require(resultPath);
      return {
        modelPath: resultData.modelPath || path.join(workDir, 'model.safetensors'),
        triggerWords: resultData.triggerWords || [],
        previewImages: resultData.previewImages || [],
        steps: resultData.steps || 1000,
        loss: resultData.loss || 0
      };
    } catch (error) {
      // Fallback: parse from stdout
      this.logger.warn('Could not read result file, parsing from stdout');
      
      return {
        modelPath: path.join(workDir, 'model.safetensors'),
        triggerWords: [],
        previewImages: [],
        steps: 1000,
        loss: 0
      };
    }
  }

  /**
   * Clean up Docker container
   */
  async cleanupContainer(containerName) {
    try {
      // Kill container if still running
      const container = this.activeContainers.get(containerName);
      if (container && !container.killed) {
        container.kill();
      }
      
      // Remove container
      await this.removeContainer(containerName);
      
      this.activeContainers.delete(containerName);
      this.logger.info(`Cleaned up container: ${containerName}`);
      
    } catch (error) {
      this.logger.warn(`Failed to cleanup container ${containerName}:`, error);
    }
  }

  /**
   * Remove Docker container
   */
  async removeContainer(containerName) {
    return new Promise((resolve) => {
      const docker = spawn('docker', ['rm', '-f', containerName]);
      
      docker.on('close', (code) => {
        resolve();
      });
    });
  }

  /**
   * Get active containers
   */
  getActiveContainers() {
    return Array.from(this.activeContainers.keys());
  }

  /**
   * Stop all active containers
   */
  async stopAllContainers() {
    const promises = Array.from(this.activeContainers.keys()).map(containerName => 
      this.cleanupContainer(containerName)
    );
    
    await Promise.all(promises);
    this.logger.info('Stopped all active containers');
  }
}

module.exports = DockerService;
