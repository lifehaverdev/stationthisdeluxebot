/**
 * FLUX Training Recipe
 * 
 * Training recipe for FLUX LoRA models
 */

class FLUXRecipe {
  constructor({ logger }) {
    this.logger = logger;
    this.modelType = 'FLUX';
    this.name = 'FLUX LoRA Training';
    this.description = 'Train LoRA models for FLUX using Kohya SS';
  }

  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  getBaseImage() {
    return 'flux-training:latest';
  }

  getSupportedFormats() {
    return ['jpg', 'jpeg', 'png', 'webp'];
  }

  getDefaultSteps() {
    return 2000;
  }

  getDefaultLearningRate() {
    return 0.0002;
  }

  isGpuRequired() {
    return true;
  }

  getEstimatedTime() {
    return 240; // 60 minutes for FLUX
  }

  getMinImages() {
    return 15;
  }

  getMaxImages() {
    return 150;
  }

  getRecommendedImages() {
    return 30;
  }

  getImageSize() {
    return '1024x1024';
  }

  getCostPoints() {
    return 200;
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

# Install Python dependencies for FLUX
RUN pip3 install --no-cache-dir \
    pyyaml \
    torch==2.0.1+cu118 \
    torchvision==0.15.2+cu118 \
    --index-url https://download.pytorch.org/whl/cu118

RUN pip3 install --no-cache-dir \
    diffusers==0.21.4 \
    transformers==4.33.2 \
    accelerate==0.21.0 \
    xformers==0.0.21 \
    safetensors==0.3.3 \
    pillow==10.0.0 \
    numpy==1.24.3

# Clone FLUX training repository
RUN git clone https://github.com/black-forest-labs/FLUX.1-dev.git /workspace/flux-training
WORKDIR /workspace/flux-training

# Install FLUX dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Write lightweight launcher script that converts job.json -> ai-toolkit YAML and kicks off training
RUN cat << 'PY' > /workspace/train_flux.py
import os, json, uuid, subprocess, sys
try:
    import yaml  # pyyaml
except ImportError:
    sys.stderr.write("pyyaml missing\n"); sys.exit(1)

job_json = os.environ.get('JOB_JSON', '/workspace/job.json')
if not os.path.isfile(job_json):
    sys.stderr.write(f"Job config not found: {job_json}\n"); sys.exit(1)

with open(job_json) as f:
    cfg = json.load(f)

yaml_cfg = {
    'model': {'name_or_path': 'black-forest-labs/FLUX.1-dev'},
    'datasets': {'folder_path': cfg['datasetPath']},
    'train': {
        'steps': cfg.get('steps', 2000),
        'batch_size': cfg.get('batchSize', 1),
        'lr': cfg.get('learningRate', 2e-4)
    },
    'network': {
        'type': 'lora',
        'rank': cfg.get('loraRank', 32),
        'alpha': cfg.get('loraAlpha', 64),
        'dropout': cfg.get('loraDropout', 0.1)
    },
    'sample': {'guidance_scale': 1, 'sample_steps': 4},
    'output': {'output_path': cfg.get('outputPath', '/workspace/output')}
}

yaml_path = f"/workspace/config_{uuid.uuid4().hex}.yml"
import yaml as _yaml
with open(yaml_path, 'w') as yf:
    _yaml.safe_dump(yaml_cfg, yf)

cmd = ['python', '/workspace/flux-training/run.py', yaml_path]
print('Running:', ' '.join(cmd), flush=True)
subprocess.check_call(cmd)
PY

RUN chmod +x /workspace/train_flux.py

# Set entrypoint
ENTRYPOINT ["python3", "/workspace/train_flux.py"]
`;
  }

  async prepareTrainingConfig(job, datasetPath) {
    const config = {
      datasetPath: datasetPath,
      outputPath: '/workspace/output',
      modelType: this.modelType,
      baseModel: job.baseModel || 'FLUX',
      steps: job.steps || this.getDefaultSteps(),
      learningRate: job.learningRate || this.getDefaultLearningRate(),
      batchSize: job.batchSize || 1,
      resolution: job.resolution || '1024,1024',
      loraRank: job.loraRank || 32,
      loraAlpha: job.loraAlpha || 64,
      loraDropout: job.loraDropout || 0.1,
      optimizer: job.optimizer || 'AdamW8bit',
      scheduler: job.scheduler || 'cosine',
      warmupSteps: job.warmupSteps || 200,
      validationSteps: job.validationSteps || 200,
      validationImages: job.validationImages || 4,
      saveSteps: job.saveSteps || 1000,
      saveLastNSteps: job.saveLastNSteps || 3,
      triggerWords: job.triggerWords || [],
      jobId: job._id.toString(),
      datasetId: job.datasetId.toString(),
      ownerId: job.ownerAccountId.toString()
    };

    this.logger.info(`Prepared FLUX training config for job ${job._id}`);
    return config;
  }

  validateConfig(config) {
    const errors = [];
    
    if (!config.datasetPath) {
      errors.push('Dataset path is required');
    }
    
    if (!config.steps || config.steps < 200) {
      errors.push('Steps must be at least 200 for FLUX');
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
      loraRank: 32,
      loraAlpha: 64,
      loraDropout: 0.1,
      optimizer: 'AdamW8bit',
      scheduler: 'cosine',
      warmupSteps: 200,
      validationSteps: 200,
      validationImages: 4,
      saveSteps: 1000,
      saveLastNSteps: 3
    };
  }
}

module.exports = FLUXRecipe;
