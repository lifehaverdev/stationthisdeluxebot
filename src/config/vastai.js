const path = require('path');

const REQUIRED_ENV_VARS = ['VASTAI_API_KEY'];

function getRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var ${key} for VastAI config`);
  }
  return value;
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getVastAIConfig(overrides = {}) {
  const config = {
    apiBaseUrl: process.env.VASTAI_API_BASE_URL || 'https://console.vast.ai/api/v0',
    apiKey: getRequiredEnv('VASTAI_API_KEY'),
    sshKeyPath: process.env.VASTAI_SSH_KEY_PATH
      ? path.resolve(process.env.VASTAI_SSH_KEY_PATH)
      : null,
    preferredGpuTypes: parseCsv(process.env.VASTAI_PREFERRED_GPUS) || ['4090', 'A100'],
    preferredTemplates: parseCsv(process.env.VASTAI_TEMPLATE_IDS),
    maxBidUsdPerHour: parseFloat(process.env.VASTAI_MAX_BID_PER_HOUR || '4.50'),
    minVramGb: parseInt(process.env.VASTAI_MIN_VRAM_GB || '24', 10),
    defaultDiskGb: parseInt(process.env.VASTAI_DEFAULT_DISK_GB || '64', 10),
    availabilityZones: parseCsv(process.env.VASTAI_PREFERRED_REGIONS),
    defaultImage: process.env.VASTAI_DEFAULT_IMAGE || 'vastai/base-image:@vastai-automatic-tag',
    loggerLabel: 'VastAIService',
    ...overrides
  };

  if (!config.sshKeyPath) {
    // Worker may still inject via runtime config later, but warn early in dev.
    console.warn('[vastai config] VASTAI_SSH_KEY_PATH not set; provisioning will fail until a key is configured');
  }

  return config;
}

module.exports = {
  getVastAIConfig,
  REQUIRED_ENV_VARS
};
