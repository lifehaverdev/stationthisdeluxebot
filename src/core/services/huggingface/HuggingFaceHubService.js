/**
 * HuggingFaceHubService
 *
 * Service for interacting with HuggingFace Hub API.
 * Handles repository creation, file uploads, and model management.
 *
 * Requires HF_TOKEN environment variable with write access.
 */

const fs = require('fs');
const path = require('path');

const HF_API_BASE = 'https://huggingface.co/api';
const HF_UPLOAD_BASE = 'https://huggingface.co';

class HuggingFaceHubService {
  /**
   * @param {object} options
   * @param {string} [options.token] - HuggingFace token (defaults to HF_TOKEN env)
   * @param {string} [options.defaultOrg] - Default organization for repos
   * @param {object} [options.logger] - Logger instance
   */
  constructor({ token, defaultOrg = 'ms2stationthis', logger } = {}) {
    this.token = token || process.env.HF_TOKEN;
    this.defaultOrg = defaultOrg;
    this.logger = logger || console;

    if (!this.token) {
      this.logger.warn('[HuggingFaceHub] No HF_TOKEN set - uploads will fail');
    }
  }

  /**
   * Create a new model repository
   *
   * @param {object} params
   * @param {string} params.name - Repository name (without org prefix)
   * @param {string} [params.org] - Organization (defaults to defaultOrg)
   * @param {boolean} [params.private] - Whether repo is private
   * @returns {Promise<{repoId: string, url: string, created: boolean}>}
   */
  async createRepo({ name, org, private: isPrivate = false }) {
    const organization = org || this.defaultOrg;
    const repoId = `${organization}/${name}`;

    this.logger.info(`[HuggingFaceHub] Creating repo: ${repoId}`);

    // Check if repo already exists
    const exists = await this.repoExists(repoId);
    if (exists) {
      this.logger.info(`[HuggingFaceHub] Repo ${repoId} already exists`);
      return {
        repoId,
        url: `https://huggingface.co/${repoId}`,
        created: false,
      };
    }

    const response = await fetch(`${HF_API_BASE}/repos/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        organization,
        type: 'model',
        private: isPrivate,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create repo ${repoId}: ${response.status} - ${error}`);
    }

    const result = await response.json();
    this.logger.info(`[HuggingFaceHub] Created repo: ${repoId}`);

    return {
      repoId,
      url: result.url || `https://huggingface.co/${repoId}`,
      created: true,
    };
  }

  /**
   * Check if a repository exists
   *
   * @param {string} repoId - Full repo ID (org/name)
   * @returns {Promise<boolean>}
   */
  async repoExists(repoId) {
    try {
      const response = await fetch(`${HF_API_BASE}/models/${repoId}`, {
        headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {},
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Upload a file to a repository using the commit API
   *
   * @param {object} params
   * @param {string} params.repoId - Full repo ID (org/name)
   * @param {string} params.filePath - Local file path
   * @param {string} params.pathInRepo - Path in the repository (e.g., 'README.md')
   * @param {string} [params.content] - File content (alternative to filePath)
   * @param {string} [params.commitMessage] - Commit message
   * @returns {Promise<{url: string}>}
   */
  async uploadFile({ repoId, filePath, pathInRepo, content, commitMessage }) {
    this.logger.info(`[HuggingFaceHub] Uploading ${pathInRepo} to ${repoId}`);

    let fileContent;
    let isText = false;

    if (content !== undefined) {
      fileContent = Buffer.from(content, 'utf-8');
      isText = true;
    } else if (filePath) {
      fileContent = fs.readFileSync(filePath);
      // Detect if it's a text file based on extension
      isText = /\.(txt|md|json|yaml|yml)$/i.test(pathInRepo);
    } else {
      throw new Error('Either filePath or content must be provided');
    }

    const message = commitMessage || `Upload ${pathInRepo}`;

    // Use the commit API (new HuggingFace endpoint)
    const commitUrl = `${HF_API_BASE}/models/${repoId}/commit/main`;

    // Build NDJSON payload for commit API
    // Each line is {"key": "...", "value": {...}}
    // Line 1: header with commit metadata
    // Line 2+: file operations
    const header = JSON.stringify({
      key: 'header',
      value: { summary: message },
    });
    const operation = JSON.stringify({
      key: 'file',
      value: {
        path: pathInRepo,
        content: fileContent.toString('base64'),
        encoding: 'base64',
      },
    });
    const body = `${header}\n${operation}`;

    const response = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-ndjson',
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload ${pathInRepo}: ${response.status} - ${error}`);
    }

    this.logger.info(`[HuggingFaceHub] Uploaded ${pathInRepo}`);
    return {
      url: `https://huggingface.co/${repoId}/blob/main/${pathInRepo}`,
    };
  }

  /**
   * Upload multiple files to a repository
   *
   * @param {object} params
   * @param {string} params.repoId - Full repo ID
   * @param {Array<{localPath: string, repoPath: string}>} params.files - Files to upload
   * @param {string} [params.commitMessage] - Commit message
   * @returns {Promise<{uploaded: string[]}>}
   */
  async uploadFiles({ repoId, files, commitMessage }) {
    const uploaded = [];

    for (const file of files) {
      await this.uploadFile({
        repoId,
        filePath: file.localPath,
        pathInRepo: file.repoPath,
        commitMessage: commitMessage || `Upload ${file.repoPath}`,
      });
      uploaded.push(file.repoPath);
    }

    return { uploaded };
  }

  /**
   * Upload a folder of files to a repository
   *
   * @param {object} params
   * @param {string} params.repoId - Full repo ID
   * @param {string} params.localFolder - Local folder path
   * @param {string} params.repoFolder - Folder path in repo (e.g., 'samples/')
   * @param {string} [params.commitMessage] - Commit message
   * @returns {Promise<{uploaded: string[]}>}
   */
  async uploadFolder({ repoId, localFolder, repoFolder, commitMessage }) {
    this.logger.info(`[HuggingFaceHub] Uploading folder ${localFolder} to ${repoId}/${repoFolder}`);

    const files = fs.readdirSync(localFolder);
    const uploaded = [];

    for (const file of files) {
      const localPath = path.join(localFolder, file);
      const stat = fs.statSync(localPath);

      if (stat.isFile()) {
        const repoPath = `${repoFolder}${file}`;
        await this.uploadFile({
          repoId,
          filePath: localPath,
          pathInRepo: repoPath,
          commitMessage: commitMessage || `Upload ${repoPath}`,
        });
        uploaded.push(repoPath);
      }
    }

    return { uploaded };
  }

  /**
   * Create repo and upload README in one operation
   * Used for "reserving" a repo before training starts
   *
   * @param {object} params
   * @param {string} params.name - Repo name
   * @param {string} params.readme - README content
   * @param {string} [params.org] - Organization
   * @returns {Promise<{repoId: string, url: string}>}
   */
  async createRepoWithReadme({ name, readme, org }) {
    const { repoId, url } = await this.createRepo({ name, org });

    await this.uploadFile({
      repoId,
      content: readme,
      pathInRepo: 'README.md',
      commitMessage: 'Initial model card',
    });

    return { repoId, url };
  }

  /**
   * Upload trained model artifacts (post-training)
   *
   * @param {object} params
   * @param {string} params.repoId - Full repo ID
   * @param {string} params.safetensorsPath - Path to .safetensors file
   * @param {string} [params.samplesFolder] - Path to samples folder
   * @returns {Promise<{modelUrl: string, uploaded: string[]}>}
   */
  async uploadModelArtifacts({ repoId, safetensorsPath, samplesFolder }) {
    const uploaded = [];

    // Upload safetensors
    const modelName = path.basename(safetensorsPath);
    await this.uploadFile({
      repoId,
      filePath: safetensorsPath,
      pathInRepo: modelName,
      commitMessage: `Upload trained model: ${modelName}`,
    });
    uploaded.push(modelName);

    // Upload samples if provided
    if (samplesFolder && fs.existsSync(samplesFolder)) {
      const { uploaded: sampleFiles } = await this.uploadFolder({
        repoId,
        localFolder: samplesFolder,
        repoFolder: 'samples/',
        commitMessage: 'Upload sample images',
      });
      uploaded.push(...sampleFiles);
    }

    return {
      modelUrl: `https://huggingface.co/${repoId}`,
      uploaded,
    };
  }
}

module.exports = HuggingFaceHubService;
