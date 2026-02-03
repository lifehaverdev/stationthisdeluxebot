const REQUIRED_ENV_VARS = ['RUNPOD_API_KEY'];

function getRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var ${key} for RunPod config`);
  }
  return value;
}

function getOptionalEnv(key, defaultValue = null) {
  return process.env[key] || defaultValue;
}

/**
 * RunPod Serverless Configuration
 *
 * Environment variables:
 * - RUNPOD_API_KEY (required): Your RunPod API key
 * - RUNPOD_API_BASE_URL: Base URL override (default: https://api.runpod.ai/v2)
 * - RUNPOD_COMFYUI_ENDPOINT_ID: Endpoint ID for ComfyUI worker
 * - RUNPOD_DEFAULT_TIMEOUT_MS: Default request timeout
 * - RUNPOD_POLL_INTERVAL_MS: Status polling interval
 * - RUNPOD_MAX_POLL_ATTEMPTS: Max polling attempts before timeout
 */
function getRunPodConfig(overrides = {}) {
  const config = {
    // API settings
    apiKey: getRequiredEnv('RUNPOD_API_KEY'),
    apiBaseUrl: getOptionalEnv('RUNPOD_API_BASE_URL', 'https://api.runpod.ai/v2'),

    // Endpoint IDs - configure per workload type
    endpoints: {
      comfyui: getOptionalEnv('RUNPOD_COMFYUI_ENDPOINT_ID'),
      // Add more endpoint types as needed:
      // training: getOptionalEnv('RUNPOD_TRAINING_ENDPOINT_ID'),
      // inference: getOptionalEnv('RUNPOD_INFERENCE_ENDPOINT_ID'),
    },

    // Timeouts and polling
    defaultTimeoutMs: parseInt(getOptionalEnv('RUNPOD_DEFAULT_TIMEOUT_MS', '30000'), 10),
    syncTimeoutMs: parseInt(getOptionalEnv('RUNPOD_SYNC_TIMEOUT_MS', '90000'), 10),
    pollIntervalMs: parseInt(getOptionalEnv('RUNPOD_POLL_INTERVAL_MS', '1000'), 10),
    maxPollAttempts: parseInt(getOptionalEnv('RUNPOD_MAX_POLL_ATTEMPTS', '300'), 10),

    // Webhook for async completion notifications (optional)
    webhookUrl: getOptionalEnv('RUNPOD_WEBHOOK_URL'),

    loggerLabel: 'RunPodService',

    ...overrides
  };

  // Validate at least one endpoint is configured
  const hasEndpoint = Object.values(config.endpoints).some(Boolean);
  if (!hasEndpoint) {
    console.warn('[runpod config] No endpoint IDs configured. Set RUNPOD_COMFYUI_ENDPOINT_ID or similar.');
  }

  return config;
}

module.exports = {
  getRunPodConfig,
  REQUIRED_ENV_VARS
};
