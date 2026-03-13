const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const registry = require('../adapterRegistry');

const execFileAsync = promisify(execFile);
const mkdtemp = promisify(fs.mkdtemp);
const writeFile = promisify(fs.writeFile);
const rm = promisify(fs.rm);

// Resource limits
const MAX_INPUT_FILES = 20;
const MAX_FILE_SIZE_MB = 500;
const DOWNLOAD_TIMEOUT_MS = 60000;
const PROCESS_TIMEOUT_MS = 300000;

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    // Block private/internal networks
    if (parsed.hostname === 'localhost' || parsed.hostname.startsWith('127.') ||
        parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.') ||
        parsed.hostname.startsWith('169.254.') || parsed.hostname === '0.0.0.0') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, destPath) {
  if (!isAllowedUrl(url)) throw new Error(`URL not allowed: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new Error(`File too large: ${contentLength} bytes`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer);
    return destPath;
  } finally {
    clearTimeout(timeout);
  }
}

class FFmpegAdapter {
  constructor() {
    this.logger = console;
  }

  async execute(params) {
    const { mode, videos, transition, outputFormat } = params;

    if (mode !== 'concat') throw new Error(`Unsupported FFmpeg mode: ${mode}`);

    // videos can be a single URL string or array of URLs
    const videoUrls = Array.isArray(videos) ? videos : [videos];
    if (videoUrls.length === 0) throw new Error('No video URLs provided');
    if (videoUrls.length > MAX_INPUT_FILES) throw new Error(`Too many inputs (max ${MAX_INPUT_FILES})`);

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ffmpeg-'));
    const format = outputFormat || 'mp4';
    const outputPath = path.join(tmpDir, `output.${format}`);

    try {
      // Download all videos
      const localPaths = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const ext = path.extname(new URL(videoUrls[i]).pathname) || '.mp4';
        const dest = path.join(tmpDir, `input_${i}${ext}`);
        await downloadFile(videoUrls[i], dest);
        localPaths.push(dest);
      }

      // Build concat file list
      const concatList = localPaths.map(p => `file '${p}'`).join('\n');
      const concatFile = path.join(tmpDir, 'concat.txt');
      await writeFile(concatFile, concatList);

      // Run FFmpeg concat
      const args = ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outputPath];

      await execFileAsync('ffmpeg', args, { timeout: PROCESS_TIMEOUT_MS });

      // Return local path — caller (generationExecutionService) handles CDN upload
      return {
        type: 'video',
        data: { videoUrl: outputPath },
        status: 'succeeded',
        localFile: outputPath,
        tmpDir, // caller should clean up
      };
    } catch (err) {
      // Clean up on error
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`FFmpeg error: ${err.message}`);
    }
  }
}

const adapter = new FFmpegAdapter();
registry.register('ffmpeg', adapter);
module.exports = adapter;
