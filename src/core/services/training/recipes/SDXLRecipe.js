/**
 * SDXL Training Recipe
 * 
 * Training recipe for Stable Diffusion XL LoRA models
 */

const path = require('path');

class SDXLRecipe {
  constructor({ logger }) {
    this.logger = logger;
    this.modelType = 'SDXL';
    this.name = 'Stable Diffusion XL LoRA Training';
    this.description = 'Train LoRA models for Stable Diffusion XL using Kohya SS';
  }

  /**
   * Get recipe name
   */
  getName() {
    return this.name;
  }

  /**
   * Get recipe description
   */
  getDescription() {
    return this.description;
  }

  /**
   * Get base Docker image
   */
  getBaseImage() {
    return 'kohya-ss:latest';
  }

  /**
   * Get supported image formats
   */
  getSupportedFormats() {
    return ['jpg', 'jpeg', 'png', 'webp'];
  }

  /**
   * Get default training steps
   */
  getDefaultSteps() {
    return 1000;
  }

  /**
   * Get default learning rate
   */
  getDefaultLearningRate() {
    return 0.0004;
  }

  /**
   * Check if GPU is required
   */
  isGpuRequired() {
    return true;
  }

  /**
   * Get estimated training time (minutes)
   */
  getEstimatedTime() {
    return 30; // 30 minutes for SDXL
  }

  /**
   * Get minimum number of images
   */
  getMinImages() {
    return 10;
  }

  /**
   * Get maximum number of images
   */
  getMaxImages() {
    return 100;
  }

  /**
   * Get recommended number of images
   */
  getRecommendedImages() {
    return 20;
  }

  /**
   * Get required image size
   */
  getImageSize() {
    return '1024x1024';
  }

  /**
   * Get cost in points
   */
  getCostPoints() {
    return 100;
  }

  /**
   * Generate Dockerfile for SDXL training
   */
  async generateDockerfile() {
    return `FROM nvidia/cuda:11.8-devel-ubuntu22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    python3 \\
    python3-pip \\
    git \\
    wget \\
    curl \\
    libgl1-mesa-glx \\
    libglib2.0-0 \\
    libsm6 \\
    libxext6 \\
    libxrender-dev \\
    libgomp1 \\
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Install Python dependencies
RUN pip3 install --no-cache-dir \\
    torch==2.0.1+cu118 \\
    torchvision==0.15.2+cu118 \\
    torchaudio==2.0.2+cu118 \\
    --index-url https://download.pytorch.org/whl/cu118

RUN pip3 install --no-cache-dir \\
    diffusers==0.21.4 \\
    transformers==4.33.2 \\
    accelerate==0.21.0 \\
    xformers==0.0.21 \\
    bitsandbytes==0.41.1 \\
    safetensors==0.3.3 \\
    pillow==10.0.0 \\
    numpy==1.24.3 \\
    scipy==1.11.1 \\
    scikit-learn==1.3.0 \\
    matplotlib==3.7.2 \\
    tqdm==4.65.0

# Clone Kohya SS
RUN git clone https://github.com/kohya-ss/sd-scripts.git /workspace/sd-scripts
WORKDIR /workspace/sd-scripts
RUN pip3 install --no-cache-dir -r requirements.txt

# Create training script
COPY train_sdxl.py /workspace/train_sdxl.py
RUN chmod +x /workspace/train_sdxl.py

# Set entrypoint
ENTRYPOINT ["python3", "/workspace/train_sdxl.py"]
`;
  }

  /**
   * Prepare training configuration
   * @param {Object} job - Training job object
   * @param {string} datasetPath - Path to dataset
   * @returns {Promise<Object>} Training configuration
   */
  async prepareTrainingConfig(job, datasetPath) {
    const config = {
      // Dataset configuration
      datasetPath: datasetPath,
      outputPath: '/workspace/output',
      
      // Model configuration
      modelType: this.modelType,
      baseModel: job.baseModel || 'SDXL',
      
      // Training parameters
      steps: job.steps || this.getDefaultSteps(),
      learningRate: job.learningRate || this.getDefaultLearningRate(),
      batchSize: job.batchSize || 1,
      resolution: job.resolution || '1024,1024',
      
      // LoRA configuration
      loraRank: job.loraRank || 16,
      loraAlpha: job.loraAlpha || 32,
      loraDropout: job.loraDropout || 0.1,
      
      // Optimization
      optimizer: job.optimizer || 'AdamW8bit',
      scheduler: job.scheduler || 'cosine',
      warmupSteps: job.warmupSteps || 100,
      
      // Validation
      validationSteps: job.validationSteps || 100,
      validationImages: job.validationImages || 4,
      
      // Output configuration
      saveSteps: job.saveSteps || 500,
      saveLastNSteps: job.saveLastNSteps || 3,
      
      // Trigger words
      triggerWords: job.triggerWords || [],
      
      // Job metadata
      jobId: job._id.toString(),
      datasetId: job.datasetId.toString(),
      ownerId: job.ownerAccountId.toString()
    };

    this.logger.info(`Prepared SDXL training config for job ${job._id}`);
    return config;
  }

  /**
   * Validate training configuration
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validation result
   */
  validateConfig(config) {
    const errors = [];
    
    // Required fields
    if (!config.datasetPath) {
      errors.push('Dataset path is required');
    }
    
    if (!config.steps || config.steps < 100) {
      errors.push('Steps must be at least 100');
    }
    
    if (!config.learningRate || config.learningRate <= 0) {
      errors.push('Learning rate must be positive');
    }
    
    if (!config.batchSize || config.batchSize < 1) {
      errors.push('Batch size must be at least 1');
    }
    
    if (!config.loraRank || config.loraRank < 1) {
      errors.push('LoRA rank must be at least 1');
    }
    
    // Validate resolution format
    if (config.resolution && !/^\d+,\d+$/.test(config.resolution)) {
      errors.push('Resolution must be in format "width,height"');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Get default configuration
   * @returns {Object} Default configuration
   */
  getDefaultConfig() {
    return {
      steps: this.getDefaultSteps(),
      learningRate: this.getDefaultLearningRate(),
      batchSize: 1,
      resolution: '1024,1024',
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.1,
      optimizer: 'AdamW8bit',
      scheduler: 'cosine',
      warmupSteps: 100,
      validationSteps: 100,
      validationImages: 4,
      saveSteps: 500,
      saveLastNSteps: 3
    };
  }

  /**
   * Generate training script content
   * @param {Object} config - Training configuration
   * @returns {string} Training script content
   */
  generateTrainingScript(config) {
    return `#!/usr/bin/env python3
"""
SDXL LoRA Training Script
Generated for job ${config.jobId}
"""

import os
import json
import sys
import subprocess
from pathlib import Path

def main():
    # Load configuration
    config_str = os.environ.get('TRAINING_CONFIG', '{}')
    config = json.loads(config_str)
    
    print(f"Starting SDXL training for job {config.get('jobId', 'unknown')}")
    print(f"Dataset path: {config.get('datasetPath', 'unknown')}")
    print(f"Steps: {config.get('steps', 1000)}")
    print(f"Learning rate: {config.get('learningRate', 0.0004)}")
    
    # Prepare training command
    cmd = [
        'python3', 'train_network.py',
        '--pretrained_model_name_or_path', 'stabilityai/stable-diffusion-xl-base-1.0',
        '--train_data_dir', config['datasetPath'],
        '--output_dir', config['outputPath'],
        '--output_name', f"lora_{config['jobId']}",
        '--save_model_as', 'safetensors',
        '--prior_loss_weight', '1.0',
        '--resolution', config.get('resolution', '1024,1024'),
        '--train_batch_size', str(config.get('batchSize', 1)),
        '--max_train_epochs', '1',
        '--max_train_steps', str(config.get('steps', 1000)),
        '--learning_rate', str(config.get('learningRate', 0.0004)),
        '--optimizer_type', config.get('optimizer', 'AdamW8bit'),
        '--lr_scheduler', config.get('scheduler', 'cosine'),
        '--lr_warmup_steps', str(config.get('warmupSteps', 100)),
        '--network_module', 'networks.lora',
        '--network_dim', str(config.get('loraRank', 16)),
        '--network_alpha', str(config.get('loraAlpha', 32)),
        '--network_dropout', str(config.get('loraDropout', 0.1)),
        '--save_every_n_epochs', '1',
        '--save_last_n_epochs', str(config.get('saveLastNSteps', 3)),
        '--save_state',
        '--cache_latents',
        '--cache_latents_to_disk',
        '--persistent_data_loader_workers',
        '--max_data_loader_n_workers', '2',
        '--mixed_precision', 'fp16',
        '--xformers',
        '--bucket_no_upscale',
        '--noise_offset', '0.1',
        '--lowram'
    ]
    
    # Add validation if configured
    if config.get('validationSteps', 0) > 0:
        cmd.extend([
            '--validation_steps', str(config['validationSteps']),
            '--validation_images', str(config.get('validationImages', 4))
        ])
    
    print(f"Running command: {' '.join(cmd)}")
    
    # Run training
    try:
        result = subprocess.run(cmd, cwd='/workspace/sd-scripts', check=True, capture_output=True, text=True)
        print("Training completed successfully!")
        print(result.stdout)
        
        # Generate result file
        result_data = {
            'modelPath': os.path.join(config['outputPath'], f"lora_{config['jobId']}.safetensors"),
            'triggerWords': config.get('triggerWords', []),
            'previewImages': [],
            'steps': config.get('steps', 1000),
            'loss': 0.0,
            'status': 'completed'
        }
        
        with open('/workspace/training_result.json', 'w') as f:
            json.dump(result_data, f, indent=2)
            
    except subprocess.CalledProcessError as e:
        print(f"Training failed with error: {e}")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
`;
  }
}

module.exports = SDXLRecipe;
