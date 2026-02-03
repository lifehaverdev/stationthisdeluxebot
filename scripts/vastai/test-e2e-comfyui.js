#!/usr/bin/env node
/**
 * test-e2e-comfyui.js - End-to-end test of VastAI service harness
 *
 * This script:
 * 1. Rents a GPU with ComfyUI template
 * 2. Downloads Flux Schnell model
 * 3. Runs a simple text-to-image workflow
 * 4. Uploads result to R2
 * 5. Terminates instance
 *
 * Usage: node scripts/vastai/test-e2e-comfyui.js
 */
require('dotenv').config();

const { VastAIService } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const StorageService = require('../../src/core/services/storageService');
const path = require('path');
const fs = require('fs');

// Configuration
// Using pytorch base - smaller than aitoolkit, has CUDA/Python ready
const DOCKER_IMAGE = 'pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime';
const COMFYUI_PORT = 8188;
const TEST_PROMPT = `This is a digital illustration in a fantasy art style, reminiscent of b0throps aesthetics. It features a young, white-haired female character with yellow eyes, embodying elements of b0throps style. She is adorned in silver, armored gauntlets, a chest plate, and a short skirt with thigh-high boots, all designed in a b0throps fashion. The character also has feathered wings adding a touch of b0throps flair. In her right hand, she holds a green, spiked staff, blending seamlessly with the b0throps vibes of the piece. Her fair skin and slim, athletic build are complemented by the b0throps-inspired elements present throughout the illustration.

To her left, there is a small, floating mushroom-like creature, adding a whimsical and mystical aspect to the b0throps-infused scene. The background, with its subtle light blue and gray patterns, enhances the overall b0throps aesthetic of the artwork. At the bottom left, a game-like interface with text options adds a futuristic twist to the b0throps theme, creating a unique blend of styles. The muted color palette of silver, white, and green further accentuates the b0throps influence in the illustration.`;

// Flux Schnell from HuggingFace
const FLUX_SCHNELL_URL = 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors';

// Flux component models (VAE + CLIP)
const FLUX_VAE_URL = 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors';
const FLUX_T5_URL = 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors';
const FLUX_CLIP_URL = 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors';

// b0throps LoRA from HuggingFace (user's trained model)
const LORA_URL = 'https://huggingface.co/ms2stationthis/b0throps/resolve/main/b0throps.safetensors';
const LORA_NAME = 'b0throps.safetensors';

class E2ETest {
  constructor() {
    this.logger = {
      info: (...args) => console.log(`[${new Date().toISOString()}] INFO:`, ...args),
      warn: (...args) => console.log(`[${new Date().toISOString()}] WARN:`, ...args),
      error: (...args) => console.error(`[${new Date().toISOString()}] ERROR:`, ...args),
    };

    this.vastaiConfig = getVastAIConfig();
    this.vastaiService = new VastAIService({
      logger: this.logger,
      config: this.vastaiConfig
    });

    this.instanceId = null;
    this.ssh = null;
    this.instanceInfo = null;
  }

  async run() {
    const startTime = Date.now();
    this.logger.info('=== Starting E2E ComfyUI Test ===');

    try {
      // Step 1: Find and rent GPU
      await this.rentGpu();

      // Step 2: Wait for SSH ready
      await this.waitForSsh();

      // Step 3: Setup ComfyUI (download model if needed)
      await this.setupComfyUI();

      // Step 4: Run workflow
      const outputPath = await this.runWorkflow();

      // Step 5: Upload to R2
      const r2Url = await this.uploadToR2(outputPath);

      // Step 6: Success!
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info(`=== SUCCESS in ${duration}s ===`);
      this.logger.info(`Result URL: ${r2Url}`);

    } catch (err) {
      this.logger.error('Test failed:', err.message);
      throw err;
    } finally {
      // Always cleanup
      await this.cleanup();
    }
  }

  async rentGpu() {
    this.logger.info('Step 1: Searching for GPU offers...');

    // Search for offers - need 24GB+ VRAM for Flux + LoRA
    const offers = await this.vastaiService.searchOffers({
      minVramGb: 24,
      maxHourlyUsd: 1.00,
      requireFullGpu: true,
    });

    if (!offers || offers.length === 0) {
      throw new Error('No suitable GPU offers found');
    }

    const bestOffer = offers[0];
    this.logger.info(`Found ${offers.length} offers. Best: ${bestOffer.gpuType} @ $${bestOffer.hourlyUsd}/hr`);

    // Rent it
    this.logger.info('Provisioning instance with ComfyUI image...');
    const instance = await this.vastaiService.provisionInstance({
      offerId: bestOffer.id,
      image: DOCKER_IMAGE,
      diskGb: 50, // Space for Flux (~12GB) + T5 (~10GB) + LoRA + VAE + CLIP
      label: `e2e-b0throps-${Date.now()}`,
    });

    this.instanceId = instance.instanceId;
    this.instanceInfo = instance;
    this.logger.info(`Instance ${this.instanceId} provisioned (status: ${instance.status})`);
  }

  async waitForSsh() {
    this.logger.info('Step 2: Waiting for SSH to be ready...');

    const maxWait = 300000; // 5 minutes (image needs to pull)
    const pollInterval = 10000; // 10 seconds
    const startTime = Date.now();
    let sshKeyAttached = false;

    while (Date.now() - startTime < maxWait) {
      // Get latest instance status
      const status = await this.vastaiService.getInstanceStatus(this.instanceId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      this.logger.info(`[${elapsed}s] Instance status: ${status.status}`);

      if (status.status === 'running' && (status.sshHost || status.publicIp)) {
        const host = status.sshHost || status.publicIp;
        const port = status.sshPort || 22;

        // Attach SSH key explicitly (some images don't pick it up from initial payload)
        if (!sshKeyAttached) {
          try {
            this.logger.info('Attaching SSH key to instance...');
            await this.vastaiService.attachSshKey(this.instanceId);
            sshKeyAttached = true;
            this.logger.info('SSH key attached');
          } catch (err) {
            this.logger.warn(`SSH key attach: ${err.message}`);
            sshKeyAttached = true; // Don't retry
          }
        }

        this.logger.info(`Attempting SSH to ${host}:${port}...`);

        try {
          this.ssh = new SshTransport({
            host,
            port,
            username: 'root',
            privateKeyPath: this.vastaiConfig.sshKeyPath,
            logger: this.logger,
          });

          // Test SSH with a simple command
          const result = await this.ssh.exec('echo "SSH OK" && nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 15000 });
          this.logger.info(`SSH connected! GPU: ${result.trim()}`);

          this.instanceInfo = status;
          return;
        } catch (err) {
          this.logger.warn(`SSH not ready yet: ${err.message}`);
          this.ssh = null;
        }
      }

      await this._wait(pollInterval);
    }

    throw new Error('SSH did not become ready in time');
  }

  async setupComfyUI() {
    this.logger.info('Step 3: Setting up ComfyUI...');

    const COMFY_DIR = '/root/ComfyUI';

    // Check if ComfyUI is installed
    const findComfy = await this.ssh.exec(`test -d ${COMFY_DIR} && echo "found" || echo "not found"`);

    if (findComfy.trim() !== 'found') {
      this.logger.info('ComfyUI not installed. Installing...');

      // Install git if needed (pytorch image may not have it)
      this.logger.info('Ensuring git is installed...');
      await this.ssh.exec(
        `which git || (apt-get update -qq && apt-get install -y -qq git)`,
        { timeout: 120000 }
      );

      // Clone ComfyUI
      this.logger.info('Cloning ComfyUI...');
      await this.ssh.exec(
        `cd /root && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git`,
        { timeout: 120000 }
      );
      this.logger.info('ComfyUI cloned');

      // Upgrade PyTorch - ComfyUI requires 2.4+ for torch.uint64
      this.logger.info('Upgrading PyTorch to 2.4+ (ComfyUI requirement)...');
      await this.ssh.exec(
        `pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 -q`,
        { timeout: 600000 }
      );
      this.logger.info('PyTorch upgraded');

      // Install requirements (pytorch image should have pip ready)
      this.logger.info('Installing ComfyUI requirements...');
      await this.ssh.exec(
        `cd ${COMFY_DIR} && pip install -r requirements.txt -q`,
        { timeout: 300000 }
      );
      this.logger.info('Requirements installed');
    } else {
      this.logger.info('ComfyUI already installed');
    }

    // Check if ComfyUI is already running
    let curlCheck;
    try {
      curlCheck = await this.ssh.exec(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${COMFYUI_PORT}/system_stats || echo "failed"`
      );
    } catch (e) {
      curlCheck = 'failed';
    }
    this.logger.info(`ComfyUI API check: ${curlCheck.trim()}`);

    if (curlCheck.trim() !== '200') {
      this.logger.info('Starting ComfyUI in background...');

      // Use the same pattern as TrainingRunner - setsid with all FDs redirected to /dev/null
      const wrapperScript = '/tmp/start_comfy.sh';
      const logFile = '/tmp/comfyui.log';
      const pidFile = '/tmp/comfyui.pid';

      // Write script using echo to avoid escaping issues
      const scriptLines = [
        '#!/bin/bash',
        `cd ${COMFY_DIR}`,
        `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> ${logFile} 2>&1 &`,
        'COMFY_PID=$!',
        `echo $COMFY_PID > ${pidFile}`
      ];

      // Create script file
      await this.ssh.exec(`echo '${scriptLines.join('\n')}' > ${wrapperScript} && chmod +x ${wrapperScript}`);

      // Execute with setsid (fully detached from SSH session)
      try {
        await this.ssh.exec(`setsid ${wrapperScript} </dev/null >/dev/null 2>&1 &`, { timeout: 5000 });
      } catch (err) {
        if (err.message && err.message.includes('timed out')) {
          this.logger.info('SSH channel held open (expected), proceeding...');
        } else {
          throw err;
        }
      }

      // Wait for ComfyUI to start
      this.logger.info('Waiting for ComfyUI to start...');
      await this._wait(15000);

      // Verify it started
      try {
        const pid = await this.ssh.exec(`cat ${pidFile}`);
        this.logger.info(`ComfyUI started with PID: ${pid.trim()}`);

        // Check if process is actually running
        const processCheck = await this.ssh.exec(`ps -p ${pid.trim()} -o comm= || echo "not running"`);
        this.logger.info(`Process status: ${processCheck.trim()}`);

        // Show recent log
        const recentLog = await this.ssh.exec(`tail -20 ${logFile} 2>/dev/null || echo "no log"`);
        this.logger.info(`ComfyUI log:\n${recentLog}`);
      } catch (e) {
        this.logger.warn(`Could not verify ComfyUI startup: ${e.message}`);
      }
    }

    // Store COMFY_DIR for model downloads
    this.comfyDir = COMFY_DIR;
    this.logger.info(`ComfyUI directory: ${this.comfyDir}`);

    // Use dynamic path found during setup
    const MODELS_DIR = `${this.comfyDir}/models`;

    // Check disk space
    const diskSpace = await this.ssh.exec('df -h / | tail -1');
    this.logger.info(`Disk space: ${diskSpace.trim()}`);

    // Create model directories
    this.logger.info('Creating model directories...');
    await this.ssh.exec(`mkdir -p ${MODELS_DIR}/unet ${MODELS_DIR}/vae ${MODELS_DIR}/clip ${MODELS_DIR}/loras`);

    // HuggingFace token for gated models (FLUX requires auth)
    const hfToken = process.env.HF_TOKEN;
    const hfAuth = hfToken ? `--header="Authorization: Bearer ${hfToken}"` : '';

    // Download Flux Schnell UNet (~12GB)
    const unetExists = await this.ssh.exec(`test -f ${MODELS_DIR}/unet/flux1-schnell.safetensors && echo "yes" || echo "no"`);
    if (unetExists.trim() !== 'yes') {
      this.logger.info('Downloading Flux Schnell UNet (~12GB)...');
      await this.ssh.exec(
        `wget -q --progress=dot:giga ${hfAuth} "${FLUX_SCHNELL_URL}" -O ${MODELS_DIR}/unet/flux1-schnell.safetensors`,
        { timeout: 900000 }
      );
      this.logger.info('Flux Schnell downloaded!');
    } else {
      this.logger.info('Flux Schnell already present');
    }

    // Download VAE (~335MB)
    const vaeExists = await this.ssh.exec(`test -f ${MODELS_DIR}/vae/ae.safetensors && echo "yes" || echo "no"`);
    if (vaeExists.trim() !== 'yes') {
      this.logger.info('Downloading Flux VAE (~335MB)...');
      await this.ssh.exec(
        `wget -q --progress=dot:giga ${hfAuth} "${FLUX_VAE_URL}" -O ${MODELS_DIR}/vae/ae.safetensors`,
        { timeout: 300000 }
      );
      this.logger.info('Flux VAE downloaded!');
    } else {
      this.logger.info('Flux VAE already present');
    }

    // Download T5-XXL CLIP (~9.8GB)
    const t5Exists = await this.ssh.exec(`test -f ${MODELS_DIR}/clip/t5xxl_fp16.safetensors && echo "yes" || echo "no"`);
    if (t5Exists.trim() !== 'yes') {
      this.logger.info('Downloading T5-XXL CLIP encoder (~9.8GB)...');
      await this.ssh.exec(
        `wget -q --progress=dot:giga ${hfAuth} "${FLUX_T5_URL}" -O ${MODELS_DIR}/clip/t5xxl_fp16.safetensors`,
        { timeout: 900000 }
      );
      this.logger.info('T5-XXL downloaded!');
    } else {
      this.logger.info('T5-XXL already present');
    }

    // Download CLIP-L (~235MB)
    const clipLExists = await this.ssh.exec(`test -f ${MODELS_DIR}/clip/clip_l.safetensors && echo "yes" || echo "no"`);
    if (clipLExists.trim() !== 'yes') {
      this.logger.info('Downloading CLIP-L encoder (~235MB)...');
      await this.ssh.exec(
        `wget -q --progress=dot:giga ${hfAuth} "${FLUX_CLIP_URL}" -O ${MODELS_DIR}/clip/clip_l.safetensors`,
        { timeout: 300000 }
      );
      this.logger.info('CLIP-L downloaded!');
    } else {
      this.logger.info('CLIP-L already present');
    }

    // Download b0throps LoRA (344MB)
    const loraExists = await this.ssh.exec(`test -f ${MODELS_DIR}/loras/${LORA_NAME} && echo "yes" || echo "no"`);
    if (loraExists.trim() !== 'yes') {
      this.logger.info('Downloading b0throps LoRA (344MB)...');
      await this.ssh.exec(
        `wget -q --progress=dot:giga "${LORA_URL}" -O ${MODELS_DIR}/loras/${LORA_NAME}`,
        { timeout: 300000 }
      );
      this.logger.info('b0throps LoRA downloaded!');
    } else {
      this.logger.info('b0throps LoRA already present');
    }

    // Show downloaded models
    this.logger.info('Models ready:');
    const modelList = await this.ssh.exec(`ls -lh ${MODELS_DIR}/unet/ ${MODELS_DIR}/vae/ ${MODELS_DIR}/clip/ ${MODELS_DIR}/loras/ 2>/dev/null | grep safetensors || echo "none"`);
    this.logger.info(modelList);

    // Verify ComfyUI API is responding
    // Loading ~33GB of models (Flux UNet + T5-XXL + CLIP + VAE + LoRA) takes time
    this.logger.info('Verifying ComfyUI API (may take a few minutes to load models)...');
    let apiReady = false;
    for (let i = 0; i < 60; i++) {  // 60 retries * 5s = 5 minutes max
      try {
        const check = await this.ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/system_stats`);
        if (check.includes('system')) {
          apiReady = true;
          this.logger.info('ComfyUI API ready!');
          break;
        }
      } catch (e) {}
      this.logger.info(`API check ${i+1}/60 - waiting...`);
      await this._wait(5000);
    }

    if (!apiReady) {
      // Show ComfyUI log for debugging
      const log = await this.ssh.exec('tail -50 /tmp/comfyui.log 2>/dev/null || echo "no log"');
      this.logger.error(`ComfyUI log:\n${log}`);
      throw new Error('ComfyUI API did not become ready');
    }
  }

  async runWorkflow() {
    this.logger.info('Step 4: Running ComfyUI workflow...');

    // Simple workflow that generates an image
    const workflow = this._createSimpleWorkflow(TEST_PROMPT);

    // Queue the prompt
    this.logger.info('Queueing prompt...');
    const payload = JSON.stringify({ prompt: workflow });
    // Escape for shell
    const escapedPayload = payload.replace(/'/g, "'\\''");
    const queueCmd = `curl -s -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${escapedPayload}'`;
    const queueResult = await this.ssh.exec(queueCmd);
    this.logger.info(`Queue result: ${queueResult.substring(0, 200)}`);

    let promptId;
    try {
      const parsed = JSON.parse(queueResult);
      promptId = parsed.prompt_id;
      this.logger.info(`Prompt ID: ${promptId}`);
    } catch (e) {
      this.logger.warn('Could not parse queue result, will check history...');
    }

    // Wait for completion (poll history)
    this.logger.info('Waiting for generation to complete...');
    const outputPath = await this._waitForOutput(promptId);

    return outputPath;
  }

  async _waitForOutput(promptId) {
    const maxWait = 180000; // 3 minutes (generation can take time)
    const pollInterval = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check history for completed outputs
      const history = await this.ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/history`);

      try {
        const parsed = JSON.parse(history);
        const entries = Object.values(parsed);

        // Find completed entry with outputs
        for (const entry of entries) {
          if (entry.outputs) {
            for (const nodeOutput of Object.values(entry.outputs)) {
              if (nodeOutput.images && nodeOutput.images.length > 0) {
                const img = nodeOutput.images[0];
                const outputPath = `/tmp/comfyui_output_${Date.now()}.png`;

                // Download the image from ComfyUI
                const subfolder = img.subfolder ? `&subfolder=${img.subfolder}` : '';
                const imgUrl = `http://localhost:${COMFYUI_PORT}/view?filename=${img.filename}${subfolder}&type=${img.type || 'output'}`;
                await this.ssh.exec(`curl -s "${imgUrl}" -o ${outputPath}`);

                // Verify file exists and has size
                const fileCheck = await this.ssh.exec(`ls -la ${outputPath}`);
                this.logger.info(`Output file: ${fileCheck.trim()}`);

                return outputPath;
              }
            }
          }
        }
      } catch (e) {
        this.logger.warn(`History parse error: ${e.message}`);
      }

      // Also check queue status
      try {
        const queue = await this.ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/queue`);
        const queueData = JSON.parse(queue);
        const running = queueData.queue_running?.length || 0;
        const pending = queueData.queue_pending?.length || 0;
        if (running > 0 || pending > 0) {
          this.logger.info(`Queue: ${running} running, ${pending} pending...`);
        }
      } catch (e) {}

      await this._wait(pollInterval);
    }

    throw new Error('Workflow did not complete in time');
  }

  _createSimpleWorkflow(prompt) {
    // Flux Schnell workflow with b0throps LoRA
    // Flux uses different architecture: UNet (diffusion_model) + dual CLIP + VAE
    // LoRA is applied to the UNet model via LoraLoaderModelOnly
    const seed = Math.floor(Math.random() * 1000000);

    return {
      "6": {
        "class_type": "EmptyLatentImage",
        "inputs": {
          "width": 1024,
          "height": 1024,
          "batch_size": 1
        }
      },
      "8": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": ["13", 0],
          "vae": ["10", 0]
        }
      },
      "9": {
        "class_type": "SaveImage",
        "inputs": {
          "filename_prefix": "e2e_b0throps",
          "images": ["8", 0]
        }
      },
      "10": {
        "class_type": "VAELoader",
        "inputs": {
          "vae_name": "ae.safetensors"
        }
      },
      "11": {
        "class_type": "DualCLIPLoader",
        "inputs": {
          "clip_name1": "t5xxl_fp16.safetensors",
          "clip_name2": "clip_l.safetensors",
          "type": "flux"
        }
      },
      "12": {
        "class_type": "UNETLoader",
        "inputs": {
          "unet_name": "flux1-schnell.safetensors",
          "weight_dtype": "fp8_e4m3fn"
        }
      },
      "13": {
        "class_type": "KSampler",
        "inputs": {
          "seed": seed,
          "steps": 4,
          "cfg": 1.0,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 1.0,
          "model": ["15", 0],
          "positive": ["22", 0],
          "negative": ["22", 0],
          "latent_image": ["6", 0]
        }
      },
      "15": {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {
          "model": ["12", 0],
          "lora_name": "b0throps.safetensors",
          "strength_model": 0.9
        }
      },
      "22": {
        "class_type": "CLIPTextEncodeFlux",
        "inputs": {
          "clip": ["11", 0],
          "clip_l": prompt,
          "t5xxl": prompt,
          "guidance": 3.5
        }
      }
    };
  }

  async uploadToR2(remotePath) {
    this.logger.info('Step 5: Uploading to R2...');

    // Download from instance to local temp
    const localPath = `/tmp/e2e_test_${Date.now()}.png`;
    await this.ssh.download(remotePath, localPath, { stdio: 'inherit' });

    // Check local file
    const stats = fs.statSync(localPath);
    this.logger.info(`Downloaded ${stats.size} bytes to ${localPath}`);

    if (stats.size < 1000) {
      throw new Error(`Output file too small (${stats.size} bytes), generation likely failed`);
    }

    // Upload to R2
    try {
      const storageService = new StorageService();
      const key = `e2e-tests/${Date.now()}/output.png`;

      const fileBuffer = fs.readFileSync(localPath);
      const url = await storageService.uploadBuffer(fileBuffer, key, 'image/png');

      this.logger.info(`Uploaded to R2: ${url}`);

      // Cleanup local
      fs.unlinkSync(localPath);

      return url;
    } catch (err) {
      this.logger.error('R2 upload failed:', err.message);
      // Still return local path so we know we got an image
      this.logger.info(`Local file preserved at: ${localPath}`);
      return localPath;
    }
  }

  async cleanup() {
    this.logger.info('Cleanup: Terminating instance...');

    // No disconnect needed - SshTransport is stateless

    if (this.instanceId) {
      try {
        await this.vastaiService.terminateInstance(this.instanceId);
        this.logger.info(`Instance ${this.instanceId} terminated`);
      } catch (err) {
        this.logger.error(`Failed to terminate instance ${this.instanceId}:`, err.message);
        this.logger.error('MANUAL CLEANUP REQUIRED! Instance ID:', this.instanceId);
      }
    }
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run
const test = new E2ETest();
test.run()
  .then(() => {
    console.log('\n=== Test completed successfully ===');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n=== Test failed ===');
    console.error(err);
    process.exit(1);
  });
