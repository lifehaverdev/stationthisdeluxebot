/**
 * WAN Training Recipe
 * 
 * Training recipe for WAN (Wild and Natural) LoRA models
 */

class WANRecipe {
  constructor({ logger }) {
    this.logger = logger;
    this.modelType = 'WAN';
    this.name = 'WAN LoRA Training';
    this.description = 'Train LoRA models for WAN (Wild and Natural) using Kohya SS';
  }

  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  getBaseImage() {
    return 'wan-training:latest';
  }

  getSupportedFormats() {
    return ['jpg', 'jpeg', 'png', 'webp'];
  }

  getDefaultSteps() {
    return 1500;
  }

  getDefaultLearningRate() {
    return 0.0003;
  }

  isGpuRequired() {
    return true;
  }

  getEstimatedTime() {
    return 45; // 45 minutes for WAN
  }

  getMinImages() {
    return 12;
  }

  getMaxImages() {
    return 120;
  }

  getRecommendedImages() {
    return 25;
  }

  getImageSize() {
    return '1024x1024';
  }

  getCostPoints() {
    return 150;
  }

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
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Install Python dependencies for WAN
RUN pip3 install --no-cache-dir \\
    torch==2.0.1+cu118 \\
    torchvision==0.15.2+cu118 \\
    --index-url https://download.pytorch.org/whl/cu118

RUN pip3 install --no-cache-dir \\
    diffusers==0.21.4 \\
    transformers==4.33.2 \\
    accelerate==0.21.0 \\
    xformers==0.0.21 \\
    safetensors==0.3.3 \\
    pillow==10.0.0 \\
    numpy==1.24.3

# Clone WAN training repository
RUN git clone https://github.com/wan-ai/wan-training.git /workspace/wan-training
WORKDIR /workspace/wan-training

# Install WAN dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Create training script
COPY train_wan.py /workspace/train_wan.py
RUN chmod +x /workspace/train_wan.py

# Set entrypoint
ENTRYPOINT ["python3", "/workspace/train_wan.py"]
`;
  }

  async prepareTrainingConfig(job, datasetPath) {
    const config = {
      datasetPath: datasetPath,
      outputPath: '/workspace/output',
      modelType: this.modelType,
      baseModel: job.baseModel || 'WAN',
      steps: job.steps || this.getDefaultSteps(),
      learningRate: job.learningRate || this.getDefaultLearningRate(),
      batchSize: job.batchSize || 1,
      resolution: job.resolution || '1024,1024',
      loraRank: job.loraRank || 24,
      loraAlpha: job.loraAlpha || 48,
      loraDropout: job.loraDropout || 0.1,
      optimizer: job.optimizer || 'AdamW8bit',
      scheduler: job.scheduler || 'cosine',
      warmupSteps: job.warmupSteps || 150,
      validationSteps: job.validationSteps || 150,
      validationImages: job.validationImages || 4,
      saveSteps: job.saveSteps || 750,
      saveLastNSteps: job.saveLastNSteps || 3,
      triggerWords: job.triggerWords || [],
      jobId: job._id.toString(),
      datasetId: job.datasetId.toString(),
      ownerId: job.ownerAccountId.toString()
    };

    this.logger.info(`Prepared WAN training config for job ${job._id}`);
    return config;
  }

  validateConfig(config) {
    const errors = [];
    
    if (!config.datasetPath) {
      errors.push('Dataset path is required');
    }
    
    if (!config.steps || config.steps < 150) {
      errors.push('Steps must be at least 150 for WAN');
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
    
    if (config.resolution && !/^\d+,\d+$/.test(config.resolution)) {
      errors.push('Resolution must be in format "width,height"');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  getDefaultConfig() {
    return {
      steps: this.getDefaultSteps(),
      learningRate: this.getDefaultLearningRate(),
      batchSize: 1,
      resolution: '1024,1024',
      loraRank: 24,
      loraAlpha: 48,
      loraDropout: 0.1,
      optimizer: 'AdamW8bit',
      scheduler: 'cosine',
      warmupSteps: 150,
      validationSteps: 150,
      validationImages: 4,
      saveSteps: 750,
      saveLastNSteps: 3
    };
  }
}

module.exports = WANRecipe;
