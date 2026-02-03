#!/usr/bin/env node
/**
 * benchmark-cold-start.js - Benchmark VastAI cold start variance
 *
 * Runs the ComfyUI E2E test multiple times across different instances
 * to gather data on timing variance. Records:
 * - SSH ready time
 * - Setup time (git, pip, etc.)
 * - Download time (R2 CDN)
 * - Generation time
 * - Total cold start time
 *
 * Usage:
 *   node scripts/vastai/benchmark-cold-start.js --runs 5
 *   node scripts/vastai/benchmark-cold-start.js --runs 3 --skip-generation
 *
 * Output: Results saved to docs/benchmarks/vastai-cold-start-{timestamp}.json
 */
require('dotenv').config();

const { VastAIService } = require('../../src/core/services/vastai');
const { getVastAIConfig } = require('../../src/config/vastai');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const fs = require('fs');
const path = require('path');

const DOCKER_IMAGE = 'pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime';
const COMFYUI_PORT = 8188;
const R2_BASE = 'https://models.miladystation2.net';

const MODELS = {
  unet: { url: `${R2_BASE}/unet/flux1-schnell.safetensors`, dest: 'unet/flux1-schnell.safetensors', size: '23GB' },
  vae: { url: `${R2_BASE}/vae/ae.safetensors`, dest: 'vae/ae.safetensors', size: '320MB' },
  t5xxl: { url: `${R2_BASE}/clip/t5xxl_fp16.safetensors`, dest: 'clip/t5xxl_fp16.safetensors', size: '9.2GB' },
  clip_l: { url: `${R2_BASE}/clip/clip_l.safetensors`, dest: 'clip/clip_l.safetensors', size: '235MB' },
  lora: { url: `${R2_BASE}/loras/b0throps.safetensors`, dest: 'loras/b0throps.safetensors', size: '328MB' }
};

class ColdStartBenchmark {
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

    this.results = [];
  }

  async runBenchmark(numRuns) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`VastAI Cold Start Benchmark - ${numRuns} runs`);
    console.log('='.repeat(60));

    for (let i = 0; i < numRuns; i++) {
      console.log(`\n--- Run ${i + 1}/${numRuns} ---\n`);

      try {
        const result = await this.runSingleTest(i + 1);
        this.results.push(result);
        this.printRunSummary(result);
      } catch (err) {
        this.logger.error(`Run ${i + 1} failed:`, err.message);
        this.results.push({
          run: i + 1,
          success: false,
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }

      // Brief pause between runs
      if (i < numRuns - 1) {
        console.log('\nPausing 10s before next run...');
        await this._wait(10000);
      }
    }

    this.printFinalReport();
    await this.saveResults();
  }

  async runSingleTest(runNumber) {
    const timing = {
      run: runNumber,
      success: true,
      timestamp: new Date().toISOString(),
      instanceId: null,
      gpuType: null,
      sshHost: null,
      hourlyRate: null,
      // Timing metrics (all in seconds)
      provisionTime: 0,
      sshReadyTime: 0,
      gitCloneTime: 0,
      pytorchUpgradeTime: 0,
      requirementsTime: 0,
      downloadTime: 0,
      downloadDetails: {},
      comfyuiStartTime: 0,
      generationTime: 0,
      totalTime: 0,
    };

    const totalStart = Date.now();
    let ssh = null;
    let instanceId = null;

    try {
      // Step 1: Provision
      const provisionStart = Date.now();
      const offers = await this.vastaiService.searchOffers({
        minVramGb: 24,
        maxHourlyUsd: 1.00,
        requireFullGpu: true,
      });

      if (!offers?.length) throw new Error('No offers found');

      const offer = offers[0];
      timing.gpuType = offer.gpuType;
      timing.hourlyRate = offer.hourlyUsd;
      timing.offerId = offer.id;
      timing.datacenter = offer.datacenter || offer.geolocation || 'unknown';

      const instance = await this.vastaiService.provisionInstance({
        offerId: offer.id,
        image: DOCKER_IMAGE,
        diskGb: 50,
        label: `benchmark-${runNumber}-${Date.now()}`,
      });

      instanceId = instance.instanceId;
      timing.instanceId = instanceId;
      timing.provisionTime = (Date.now() - provisionStart) / 1000;

      // Step 2: Wait for SSH
      const sshStart = Date.now();
      ssh = await this._waitForSsh(instanceId);
      timing.sshReadyTime = (Date.now() - sshStart) / 1000;

      const status = await this.vastaiService.getInstanceStatus(instanceId);
      timing.sshHost = status.sshHost || status.publicIp;

      // Step 3: Git clone
      const gitStart = Date.now();
      await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120000 });
      await ssh.exec('cd /root && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120000 });
      timing.gitCloneTime = (Date.now() - gitStart) / 1000;

      // Step 4: PyTorch upgrade
      const pytorchStart = Date.now();
      await ssh.exec('pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 -q', { timeout: 600000 });
      timing.pytorchUpgradeTime = (Date.now() - pytorchStart) / 1000;

      // Step 5: Requirements
      const reqStart = Date.now();
      await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt -q', { timeout: 300000 });
      timing.requirementsTime = (Date.now() - reqStart) / 1000;

      // Step 6: Start ComfyUI
      const comfyStart = Date.now();
      await ssh.exec(`mkdir -p /root/ComfyUI/models/unet /root/ComfyUI/models/vae /root/ComfyUI/models/clip /root/ComfyUI/models/loras`);

      const scriptLines = [
        '#!/bin/bash',
        'cd /root/ComfyUI',
        `python main.py --listen 0.0.0.0 --port ${COMFYUI_PORT} >> /tmp/comfyui.log 2>&1 &`,
        'COMFY_PID=$!',
        'echo $COMFY_PID > /tmp/comfyui.pid'
      ];
      await ssh.exec(`echo '${scriptLines.join('\n')}' > /tmp/start_comfy.sh && chmod +x /tmp/start_comfy.sh`);
      await ssh.exec('setsid /tmp/start_comfy.sh </dev/null >/dev/null 2>&1 &', { timeout: 5000 }).catch(() => {});
      await this._wait(15000);
      timing.comfyuiStartTime = (Date.now() - comfyStart) / 1000;

      // Step 7: Download models (parallel)
      const downloadStart = Date.now();
      const downloadPromises = Object.entries(MODELS).map(async ([name, config]) => {
        const destPath = `/root/ComfyUI/models/${config.dest}`;
        const start = Date.now();
        await ssh.exec(`wget -q "${config.url}" -O ${destPath}`, { timeout: 900000 });
        const duration = (Date.now() - start) / 1000;
        timing.downloadDetails[name] = duration;
        return { name, duration };
      });
      await Promise.all(downloadPromises);
      timing.downloadTime = (Date.now() - downloadStart) / 1000;

      // Step 8: Wait for API
      for (let i = 0; i < 30; i++) {
        try {
          const check = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/system_stats`);
          if (check.includes('system')) break;
        } catch (e) {}
        await this._wait(2000);
      }

      // Step 9: Run quick generation (optional)
      if (!this.skipGeneration) {
        const genStart = Date.now();
        const workflow = this._createMinimalWorkflow();
        const payload = JSON.stringify({ prompt: workflow }).replace(/'/g, "'\\''");
        await ssh.exec(`curl -s -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${payload}'`);

        // Wait for completion
        for (let i = 0; i < 60; i++) {
          const history = await ssh.exec(`curl -s http://localhost:${COMFYUI_PORT}/history`);
          try {
            const parsed = JSON.parse(history);
            const hasOutput = Object.values(parsed).some(e => e.outputs && Object.values(e.outputs).some(o => o.images?.length > 0));
            if (hasOutput) break;
          } catch (e) {}
          await this._wait(2000);
        }
        timing.generationTime = (Date.now() - genStart) / 1000;
      } else {
        timing.generationTime = 0;
        this.logger.info('Skipping generation (--skip-generation)');
      }

      timing.totalTime = (Date.now() - totalStart) / 1000;

    } finally {
      // Cleanup
      if (instanceId) {
        try {
          await this.vastaiService.terminateInstance(instanceId);
          this.logger.info(`Instance ${instanceId} terminated`);
        } catch (err) {
          this.logger.error(`Failed to terminate ${instanceId}:`, err.message);
        }
      }
    }

    return timing;
  }

  async _waitForSsh(instanceId) {
    const maxWait = 300000;
    const start = Date.now();
    let sshKeyAttached = false;

    while (Date.now() - start < maxWait) {
      const status = await this.vastaiService.getInstanceStatus(instanceId);

      if (status.status === 'running' && (status.sshHost || status.publicIp)) {
        if (!sshKeyAttached) {
          try {
            await this.vastaiService.attachSshKey(instanceId);
            sshKeyAttached = true;
          } catch (e) {
            sshKeyAttached = true;
          }
        }

        const host = status.sshHost || status.publicIp;
        const port = status.sshPort || 22;

        try {
          const ssh = new SshTransport({
            host, port,
            username: 'root',
            privateKeyPath: this.vastaiConfig.sshKeyPath,
            logger: this.logger,
          });
          await ssh.exec('echo "OK"', { timeout: 15000 });
          return ssh;
        } catch (e) {}
      }

      await this._wait(10000);
    }

    throw new Error('SSH did not become ready');
  }

  _createMinimalWorkflow() {
    const seed = Math.floor(Math.random() * 1000000);
    return {
      "6": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
      "8": { "class_type": "VAEDecode", "inputs": { "samples": ["13", 0], "vae": ["10", 0] } },
      "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "bench", "images": ["8", 0] } },
      "10": { "class_type": "VAELoader", "inputs": { "vae_name": "ae.safetensors" } },
      "11": { "class_type": "DualCLIPLoader", "inputs": { "clip_name1": "t5xxl_fp16.safetensors", "clip_name2": "clip_l.safetensors", "type": "flux" } },
      "12": { "class_type": "UNETLoader", "inputs": { "unet_name": "flux1-schnell.safetensors", "weight_dtype": "fp8_e4m3fn" } },
      "13": { "class_type": "KSampler", "inputs": { "seed": seed, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["12", 0], "positive": ["22", 0], "negative": ["22", 0], "latent_image": ["6", 0] } },
      "22": { "class_type": "CLIPTextEncodeFlux", "inputs": { "clip": ["11", 0], "clip_l": "test", "t5xxl": "test", "guidance": 3.5 } }
    };
  }

  printRunSummary(result) {
    if (!result.success) {
      console.log(`  FAILED: ${result.error}`);
      return;
    }

    console.log(`  GPU: ${result.gpuType} @ $${result.hourlyRate?.toFixed(3)}/hr`);
    console.log(`  SSH Host: ${result.sshHost}`);
    console.log(`  Timing breakdown:`);
    console.log(`    Provision:    ${result.provisionTime.toFixed(1)}s`);
    console.log(`    SSH Ready:    ${result.sshReadyTime.toFixed(1)}s`);
    console.log(`    Git Clone:    ${result.gitCloneTime.toFixed(1)}s`);
    console.log(`    PyTorch:      ${result.pytorchUpgradeTime.toFixed(1)}s`);
    console.log(`    Requirements: ${result.requirementsTime.toFixed(1)}s`);
    console.log(`    Downloads:    ${result.downloadTime.toFixed(1)}s (parallel)`);

    for (const [name, time] of Object.entries(result.downloadDetails)) {
      console.log(`      - ${name}: ${time.toFixed(1)}s`);
    }

    console.log(`    Generation:   ${result.generationTime.toFixed(1)}s`);
    console.log(`    TOTAL:        ${result.totalTime.toFixed(1)}s (${(result.totalTime / 60).toFixed(1)} min)`);
  }

  printFinalReport() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(60));

    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    console.log(`\nRuns: ${this.results.length} total, ${successful.length} successful, ${failed.length} failed`);

    if (successful.length === 0) {
      console.log('No successful runs to analyze.');
      return;
    }

    const totals = successful.map(r => r.totalTime);
    const downloads = successful.map(r => r.downloadTime);
    const sshTimes = successful.map(r => r.sshReadyTime);

    const stats = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return {
        min: Math.min(...arr),
        max: Math.max(...arr),
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        median: sorted[Math.floor(sorted.length / 2)],
      };
    };

    const totalStats = stats(totals);
    const downloadStats = stats(downloads);
    const sshStats = stats(sshTimes);

    console.log('\n--- Total Cold Start Time ---');
    console.log(`  Min:    ${totalStats.min.toFixed(1)}s (${(totalStats.min / 60).toFixed(1)} min)`);
    console.log(`  Max:    ${totalStats.max.toFixed(1)}s (${(totalStats.max / 60).toFixed(1)} min)`);
    console.log(`  Avg:    ${totalStats.avg.toFixed(1)}s (${(totalStats.avg / 60).toFixed(1)} min)`);
    console.log(`  Median: ${totalStats.median.toFixed(1)}s (${(totalStats.median / 60).toFixed(1)} min)`);

    console.log('\n--- Download Time (parallel, R2 CDN) ---');
    console.log(`  Min:    ${downloadStats.min.toFixed(1)}s`);
    console.log(`  Max:    ${downloadStats.max.toFixed(1)}s`);
    console.log(`  Avg:    ${downloadStats.avg.toFixed(1)}s`);

    console.log('\n--- SSH Ready Time ---');
    console.log(`  Min:    ${sshStats.min.toFixed(1)}s`);
    console.log(`  Max:    ${sshStats.max.toFixed(1)}s`);
    console.log(`  Avg:    ${sshStats.avg.toFixed(1)}s`);

    console.log('\n--- Conclusion ---');
    if (totalStats.avg > 600) {
      console.log(`  Cold start averaging ${(totalStats.avg / 60).toFixed(1)} min - NOT feasible for user-facing.`);
      console.log('  Recommend: warm pools, pre-baked images, or alternative providers.');
    } else if (totalStats.avg > 180) {
      console.log(`  Cold start averaging ${(totalStats.avg / 60).toFixed(1)} min - marginal for user-facing.`);
      console.log('  Recommend: warm pools for repeat users, manage expectations for new.');
    } else {
      console.log(`  Cold start averaging ${(totalStats.avg / 60).toFixed(1)} min - acceptable for user-facing.`);
    }

    const variance = ((totalStats.max - totalStats.min) / totalStats.avg * 100).toFixed(0);
    console.log(`\n  Variance: ${variance}% (${totalStats.min.toFixed(0)}s - ${totalStats.max.toFixed(0)}s)`);
    if (parseInt(variance) > 50) {
      console.log('  HIGH variance - reliability is a concern.');
    }
  }

  async saveResults() {
    const outputDir = path.join(__dirname, '../../docs/benchmarks');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `vastai-cold-start-${timestamp}.json`);

    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        runs: this.results.length,
        successful: this.results.filter(r => r.success).length,
        failed: this.results.filter(r => !r.success).length,
      },
      summary: this._generateSummary(),
      results: this.results
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
  }

  _generateSummary() {
    const successful = this.results.filter(r => r.success);
    if (successful.length === 0) return null;

    const stats = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return {
        min: Math.min(...arr),
        max: Math.max(...arr),
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        median: sorted[Math.floor(sorted.length / 2)],
      };
    };

    return {
      totalTime: stats(successful.map(r => r.totalTime)),
      sshReadyTime: stats(successful.map(r => r.sshReadyTime)),
      downloadTime: stats(successful.map(r => r.downloadTime)),
      setupTime: stats(successful.map(r => r.gitCloneTime + r.pytorchUpgradeTime + r.requirementsTime)),
    };
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI
const args = process.argv.slice(2);
const runsIdx = args.indexOf('--runs');
const numRuns = runsIdx >= 0 ? parseInt(args[runsIdx + 1]) || 3 : 3;
const skipGeneration = args.includes('--skip-generation');

if (args.includes('--help')) {
  console.log(`
VastAI Cold Start Benchmark

Usage:
  node scripts/vastai/benchmark-cold-start.js [options]

Options:
  --runs N           Number of test runs (default: 3)
  --skip-generation  Skip the image generation step (faster)
  --help             Show this help

Examples:
  node scripts/vastai/benchmark-cold-start.js --runs 5
  node scripts/vastai/benchmark-cold-start.js --runs 3 --skip-generation
`);
  process.exit(0);
}

console.log(`\nConfiguration: ${numRuns} runs, skip-generation: ${skipGeneration}\n`);

const benchmark = new ColdStartBenchmark();
benchmark.skipGeneration = skipGeneration;
benchmark.runBenchmark(numRuns).catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
