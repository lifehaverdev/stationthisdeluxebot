// Shared Constants and API Endpoints for ComfyDeploy Services

const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes (from comfyui.js, higher precedence)
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (from workflows.js)
const DEFAULT_RETRY_ATTEMPTS = 3; // from comfyui.js
const DEFAULT_RETRY_DELAY = 6000; // from comfyui.js
const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com';

console.log(`[Comfy Config] Reading process.env.WEBHOOK_URL: ${process.env.WEBHOOK_URL}`);
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook'; // from comfyui.js
console.log(`[Comfy Config] Service will use effective WEBHOOK_URL: ${WEBHOOK_URL}`);

// API Endpoints (Combined and validated)
// Note: workflows.js had a subset, comfyui.js had more. Using the superset from comfyui.js
const API_ENDPOINTS = {
  // Core API
  DEPLOYMENTS: '/api/deployments',    // GET - List all deployments 
  DEPLOYMENT: '/api/deployment',      // POST - Create deployment (Also GET /deployment/{id} in WorkflowsService, covered by specific logic there)
  WORKFLOWS: '/api/workflows',        // GET - List all workflows
  WORKFLOW: '/api/workflow',          // POST - Create workflow
  WORKFLOW_BY_ID: (id) => `/api/workflow/${id}`, // GET - Get workflow by ID (used in comfyui.js)
  WORKFLOW_VERSION: (id) => `/api/workflow_version/${id}`, // GET - Get workflow version by ID (used in comfyui.js)
  MACHINES: '/api/machines',          // GET - List all machines
  MACHINE: (id) => `/api/machine/${id}`,  // GET - Get machine by ID
  
  // Execution API
  RUN_QUEUE: '/api/run/deployment/queue', // POST - Submit run
  RUN_STATUS: (id) => `/api/run/${id}`,   // GET - Check run status
  RUN_CANCEL: (id) => `/api/run/${id}/cancel`, // POST - Cancel run
  
  // File API
  FILE_UPLOAD: '/api/file'            // POST - Get upload URL (used in comfyui.js)
};

module.exports = {
  DEFAULT_TIMEOUT,
  DEFAULT_CACHE_TTL,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY,
  COMFY_DEPLOY_API_URL,
  WEBHOOK_URL,
  API_ENDPOINTS
}; 