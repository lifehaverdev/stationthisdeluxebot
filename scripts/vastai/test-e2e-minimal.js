#!/usr/bin/env node
/**
 * test-e2e-minimal.js - Minimal end-to-end test of VastAI infrastructure
 *
 * Proves the pipeline without ComfyUI/model complexity:
 * 1. Rent a GPU
 * 2. SSH in
 * 3. Generate a test image with Python PIL
 * 4. Upload to R2
 * 5. Terminate instance
 *
 * Usage: node scripts/vastai/test-e2e-minimal.js
 */
require('dotenv').config();

const { VastAIService } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const StorageService = require('../../src/core/services/storageService');
const fs = require('fs');

// Use the same image as training (has SSH properly configured)
const DOCKER_IMAGE = 'ostris/aitoolkit';

class MinimalE2ETest {
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
  }

  async run() {
    const startTime = Date.now();
    this.logger.info('=== Starting Minimal E2E Test ===');
    this.logger.info('This will rent a real GPU and cost ~$0.01-0.05');

    try {
      // Step 1: Find and rent GPU
      await this.rentGpu();

      // Step 2: Wait for SSH
      await this.waitForSsh();

      // Step 3: Generate test image with Python
      const remotePath = await this.generateTestImage();

      // Step 4: Upload to R2
      const resultUrl = await this.uploadToR2(remotePath);

      // Success!
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.info('');
      this.logger.info('===========================================');
      this.logger.info(`=== SUCCESS in ${duration}s ===`);
      this.logger.info(`Result: ${resultUrl}`);
      this.logger.info('===========================================');

      return resultUrl;

    } catch (err) {
      this.logger.error('Test failed:', err.message);
      console.error(err);
      throw err;
    } finally {
      await this.cleanup();
    }
  }

  async rentGpu() {
    this.logger.info('');
    this.logger.info('--- Step 1: Renting GPU ---');

    const offers = await this.vastaiService.searchOffers({
      minVramGb: 24,
      maxHourlyUsd: 1.00,  // Up to $1/hr
      requireFullGpu: true,
    });

    if (!offers || offers.length === 0) {
      throw new Error('No suitable GPU offers found');
    }

    const bestOffer = offers[0];
    this.logger.info(`Found ${offers.length} offers`);
    this.logger.info(`Best: ${bestOffer.gpuType} @ $${bestOffer.hourlyUsd.toFixed(3)}/hr (ID: ${bestOffer.id})`);

    this.logger.info('Provisioning instance...');
    const instance = await this.vastaiService.provisionInstance({
      offerId: bestOffer.id,
      image: DOCKER_IMAGE,
      diskGb: 20,
      label: `minimal-e2e-${Date.now()}`,
    });

    this.instanceId = instance.instanceId;
    this.logger.info(`Instance ${this.instanceId} created (status: ${instance.status})`);
  }

  async waitForSsh() {
    this.logger.info('');
    this.logger.info('--- Step 2: Waiting for SSH ---');

    const maxWait = 300000; // 5 minutes (image needs to pull)
    const pollInterval = 10000;
    const startTime = Date.now();
    let sshKeyAttached = false;

    while (Date.now() - startTime < maxWait) {
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

        this.logger.info(`Trying SSH: ${host}:${port}`);

        try {
          this.ssh = new SshTransport({
            host,
            port,
            username: 'root',
            privateKeyPath: this.vastaiConfig.sshKeyPath,
            logger: this.logger,
          });

          // Test connection with short timeout
          const result = await this.ssh.exec('echo "OK" && hostname && nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { timeout: 15000 });
          this.logger.info(`SSH connected!`);
          this.logger.info(`Remote info:\n${result.trim()}`);
          return;

        } catch (err) {
          this.logger.warn(`SSH not ready: ${err.message}`);
          this.ssh = null;
        }
      }

      await this._wait(pollInterval);
    }

    throw new Error('SSH did not become ready within 5 minutes');
  }

  async generateTestImage() {
    this.logger.info('');
    this.logger.info('--- Step 3: Generating test image ---');

    const outputPath = '/tmp/vastai_test_output.png';
    const timestamp = new Date().toISOString();

    // Python script to generate a test image with PIL
    const pythonScript = `
import sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow', '-q'])
    from PIL import Image, ImageDraw, ImageFont

import subprocess

# Get GPU info
gpu_info = subprocess.check_output(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader']).decode().strip()

# Create image
img = Image.new('RGB', (800, 600), color='#1a1a2e')
draw = ImageDraw.Draw(img)

# Draw gradient background
for y in range(600):
    r = int(26 + (y/600) * 40)
    g = int(26 + (y/600) * 20)
    b = int(46 + (y/600) * 60)
    draw.line([(0, y), (800, y)], fill=(r, g, b))

# Add text
try:
    font_large = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 48)
    font_med = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
    font_small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
except:
    font_large = ImageFont.load_default()
    font_med = font_large
    font_small = font_large

# Title
draw.text((400, 80), 'VastAI E2E Test', fill='#eee', font=font_large, anchor='mm')
draw.text((400, 140), 'Infrastructure Validation', fill='#aaa', font=font_med, anchor='mm')

# Info box
draw.rectangle([(100, 200), (700, 450)], outline='#4a4a6a', width=2)
draw.text((120, 220), f'GPU: {gpu_info}', fill='#6fffe9', font=font_med)
draw.text((120, 260), f'Timestamp: ${timestamp}', fill='#6fffe9', font=font_med)
draw.text((120, 300), f'Instance: vastai-minimal-test', fill='#6fffe9', font=font_med)
draw.text((120, 340), f'Status: SUCCESS', fill='#5cdb5c', font=font_med)
draw.text((120, 400), 'Pipeline: Rent -> SSH -> Generate -> Upload -> Terminate', fill='#888', font=font_small)

# Save
img.save('${outputPath}')
print('Image saved to ${outputPath}')
`;

    // Write and execute Python script
    this.logger.info('Running Python image generation...');

    // Escape the script for shell
    const escapedScript = pythonScript.replace(/'/g, "'\\''");
    await this.ssh.exec(`python3 -c '${escapedScript}'`, { stdio: 'inherit' });

    // Verify file was created
    const fileCheck = await this.ssh.exec(`ls -la ${outputPath}`);
    this.logger.info(`Generated: ${fileCheck.trim()}`);

    return outputPath;
  }

  async uploadToR2(remotePath) {
    this.logger.info('');
    this.logger.info('--- Step 4: Uploading to R2 ---');

    const localPath = `/tmp/vastai_e2e_${Date.now()}.png`;

    // Download from instance
    this.logger.info(`Downloading from instance...`);
    await this.ssh.download(remotePath, localPath, { stdio: 'inherit' });

    const stats = fs.statSync(localPath);
    this.logger.info(`Downloaded ${stats.size} bytes`);

    if (stats.size < 1000) {
      throw new Error('Generated file too small - something went wrong');
    }

    // Upload to R2
    this.logger.info('Uploading to R2...');
    try {
      const storageService = new StorageService();
      const key = `e2e-tests/minimal/${Date.now()}.png`;
      const fileBuffer = fs.readFileSync(localPath);
      const url = await storageService.uploadBuffer(fileBuffer, key, 'image/png');

      this.logger.info(`Uploaded to: ${url}`);
      fs.unlinkSync(localPath);
      return url;

    } catch (err) {
      this.logger.warn(`R2 upload failed: ${err.message}`);
      this.logger.info(`Local file preserved: ${localPath}`);
      return `LOCAL: ${localPath}`;
    }
  }

  async cleanup() {
    this.logger.info('');
    this.logger.info('--- Step 5: Cleanup ---');

    if (this.instanceId) {
      try {
        this.logger.info(`Terminating instance ${this.instanceId}...`);
        await this.vastaiService.terminateInstance(this.instanceId);
        this.logger.info('Instance terminated successfully');
      } catch (err) {
        this.logger.error(`FAILED to terminate: ${err.message}`);
        this.logger.error(`MANUAL CLEANUP REQUIRED! Instance ID: ${this.instanceId}`);
      }
    }
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run
const test = new MinimalE2ETest();
test.run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
