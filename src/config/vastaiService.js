/**
 * VastAI Service Harness Configuration
 * -------------------------------------
 * Tunable configuration for the VastAI service harness including:
 * - Warm pool settings (idle timeouts)
 * - Warmth bonuses by request type
 * - Scheduling parameters
 * - Billing tier multipliers
 * - Safety limits
 * - Instance type definitions
 *
 * All values are configurable via environment variables with sensible defaults.
 */

/**
 * Parse a number from environment variable with fallback
 * @param {string} envKey - Environment variable name
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number}
 */
function parseEnvNumber(envKey, defaultValue) {
  const value = process.env[envKey];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse an integer from environment variable with fallback
 * @param {string} envKey - Environment variable name
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number}
 */
function parseEnvInt(envKey, defaultValue) {
  const value = process.env[envKey];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a JSON object from environment variable with fallback
 * @param {string} envKey - Environment variable name
 * @param {object} defaultValue - Default value if not set or invalid
 * @returns {object}
 */
function parseEnvJson(envKey, defaultValue) {
  const value = process.env[envKey];
  if (!value) {
    return defaultValue;
  }
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[vastaiService config] Failed to parse ${envKey} as JSON, using default`);
    return defaultValue;
  }
}

/**
 * Parse a comma-separated list from environment variable
 * @param {string} envKey - Environment variable name
 * @param {string[]} defaultValue - Default value if not set
 * @returns {string[]}
 */
function parseEnvCsv(envKey, defaultValue = []) {
  const value = process.env[envKey];
  if (!value) {
    return defaultValue;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Default warmth tier bonuses (seconds added to idle timeout based on request type)
const DEFAULT_WARMTH_TIERS = {
  'quick-inference': 60,   // +1 min
  'image-gen': 120,        // +2 min
  'lora-gen': 180,         // +3 min
  'video': 300,            // +5 min
  'custom': 120,           // +2 min
};

// Default billing tier multipliers (applied to base costs)
const DEFAULT_TIER_MULTIPLIERS = {
  free: 2.0,
  tokenHolder: 1.5,
  premium: 1.2,
};

// Default instance type definitions
const DEFAULT_INSTANCE_TYPES = {
  'comfy-worker': {
    image: 'stationthis/comfy-worker:latest',
    minVramGb: 24,
    preloadedModels: ['flux-schnell', 'sdxl-base'],
  },
  'custom-runner': {
    image: 'stationthis/custom-runner:latest',
    minVramGb: 24,
    preloadedModels: [],
  },
};

/**
 * Get the VastAI service harness configuration
 * @param {object} overrides - Optional overrides for any config values
 * @returns {object} The complete service configuration
 */
function getServiceConfig(overrides = {}) {
  const config = {
    // Warm Pool Settings
    idleTimeoutBase: parseEnvInt('VASTAI_IDLE_TIMEOUT_BASE', 120),           // 2 min default (seconds)
    idleTimeoutMax: parseEnvInt('VASTAI_IDLE_TIMEOUT_MAX', 600),             // 10 min max

    // Warmth bonuses by request type (seconds)
    warmthTiers: parseEnvJson('VASTAI_WARMTH_TIERS', DEFAULT_WARMTH_TIERS),

    // Scheduling
    maxQueueWait: parseEnvInt('VASTAI_MAX_QUEUE_WAIT', 300),                 // 5 min
    spinupThreshold: parseEnvInt('VASTAI_SPINUP_THRESHOLD', 3),              // queue depth triggers new instance
    maxInstances: parseEnvInt('VASTAI_MAX_INSTANCES', 2),

    // Billing tier multipliers
    tierMultipliers: parseEnvJson('VASTAI_TIER_MULTIPLIERS', DEFAULT_TIER_MULTIPLIERS),

    // Safety
    instanceMaxLifetime: parseEnvInt('VASTAI_INSTANCE_MAX_LIFETIME', 7200),  // 2 hours
    userDailySpendCap: parseEnvNumber('VASTAI_USER_DAILY_SPEND_CAP', 20),    // $20
    hourlySpendAlert: parseEnvNumber('VASTAI_HOURLY_SPEND_ALERT', 10),       // $10

    // Instance types and their docker images
    instanceTypes: parseEnvJson('VASTAI_INSTANCE_TYPES', DEFAULT_INSTANCE_TYPES),

    // Logger label for consistent logging
    loggerLabel: 'VastAIService',

    // Apply overrides
    ...overrides
  };

  return config;
}

// Export defaults for reference/testing
const DEFAULTS = {
  idleTimeoutBase: 120,
  idleTimeoutMax: 600,
  warmthTiers: DEFAULT_WARMTH_TIERS,
  maxQueueWait: 300,
  spinupThreshold: 3,
  maxInstances: 2,
  tierMultipliers: DEFAULT_TIER_MULTIPLIERS,
  instanceMaxLifetime: 7200,
  userDailySpendCap: 20,
  hourlySpendAlert: 10,
  instanceTypes: DEFAULT_INSTANCE_TYPES,
};

module.exports = {
  getServiceConfig,
  DEFAULTS,
  // Export individual defaults for convenience
  DEFAULT_WARMTH_TIERS,
  DEFAULT_TIER_MULTIPLIERS,
  DEFAULT_INSTANCE_TYPES,
};
