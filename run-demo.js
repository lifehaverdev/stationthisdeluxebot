/**
 * Demo runner script
 * 
 * This script runs either the API demo or workflow execution demo
 * using environment variables from the .env file.
 */

// Load environment variables from .env
require('dotenv').config();

// Process command line arguments
const args = process.argv.slice(2);
const demoType = args[0] || 'api'; // Default to API demo
const additionalArgs = args.slice(1);

// Check for exploration mode
const explorationMode = args.includes('--explore') || args.includes('-e');
if (explorationMode) {
  console.log('⚠️ RUNNING IN API EXPLORATION MODE ⚠️');
  process.env.API_EXPLORE_MODE = 'true';
}

console.log('==============================================');
console.log('   COMFYUI DEPLOY DEMO RUNNER');
console.log('==============================================');
console.log(`Running ${demoType} demo with environment from .env file`);
console.log('API Key present:', !!process.env.COMFY_DEPLOY_API_KEY);
console.log('API URL:', process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com (default)');
console.log('Exploration mode:', explorationMode ? 'ENABLED' : 'DISABLED');
console.log('==============================================\n');

// Check if API key is available
if (!process.env.COMFY_DEPLOY_API_KEY) {
  console.error('ERROR: COMFY_DEPLOY_API_KEY not found in .env file');
  console.error('Please make sure your .env file contains a valid API key');
  console.error('Example .env file content:');
  console.error('COMFY_DEPLOY_API_KEY=your-api-key-here');
  console.error('COMFY_DEPLOY_API_URL=https://api.comfydeploy.com');
  process.exit(1);
}

// Exploration mode helper for testing API URLs
async function exploreAPI() {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  const baseUrl = process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com';
  
  console.log('🔍 API EXPLORATION MODE');
  console.log('Testing various endpoint patterns to find working API paths\n');
  
  // Test different API prefixes
  const prefixes = ['', '/api', '/v1', '/v2', '/api/v1', '/api/v2'];
  const endpoints = ['deployment', 'deployments', 'run', 'workflow', 'workflows', 'machine', 'machines'];
  
  console.log('Testing base URL connectivity...');
  try {
    const baseResponse = await fetch(baseUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.COMFY_DEPLOY_API_KEY}`,
        'Accept': 'application/json'
      }
    });
    console.log(`Base URL (${baseUrl}): ${baseResponse.status} ${baseResponse.statusText}`);
    
    if (baseResponse.headers.get('content-type')?.includes('text/html')) {
      console.log('⚠️ WARNING: Base URL is returning HTML, not a typical API response');
    }
  } catch (error) {
    console.error(`Error accessing base URL: ${error.message}`);
  }
  
  console.log('\nTesting endpoint combinations:');
  for (const prefix of prefixes) {
    console.log(`\nTrying prefix: "${prefix || '(no prefix)'}":`);
    
    for (const endpoint of endpoints) {
      const url = `${baseUrl}${prefix}/${endpoint}`;
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${process.env.COMFY_DEPLOY_API_KEY}`,
            'Accept': 'application/json'
          }
        });
        
        const indicator = response.status === 200 ? '✅' : 
                          response.status === 401 ? '🔒' : 
                          response.status === 404 ? '❌' : '❓';
                          
        console.log(`${indicator} ${url}: ${response.status} ${response.statusText}`);
        
        if (response.status === 200 || response.status === 401) {
          console.log(`   Found working endpoint: ${url}`);
        }
      } catch (error) {
        console.error(`   Error trying ${url}: ${error.message}`);
      }
    }
  }
  
  console.log('\n🔍 API exploration complete. Use these findings to update your configuration.');
}

// Run the appropriate demo
async function runDemo() {
  try {
    // Run API exploration if in exploration mode
    if (explorationMode) {
      await exploreAPI();
      return;
    }
    
    if (demoType === 'api' || demoType === 'comfyui') {
      // Run the API integration demo
      console.log('Starting API integration demo...\n');
      require('./demo-comfyui-api');
    } else if (demoType === 'workflow' || demoType === 'execution') {
      // Run the workflow execution demo
      console.log('Starting workflow execution demo...\n');
      
      // If additional arguments are provided, pass them to the demo
      if (additionalArgs.length > 0) {
        const { spawn } = require('child_process');
        const childProcess = spawn('node', ['demo-workflow-execution.js', ...additionalArgs], {
          stdio: 'inherit'
        });
        
        childProcess.on('close', (code) => {
          console.log(`\nWorkflow demo completed with code ${code}`);
        });
      } else {
        // Default execution
        require('./demo-workflow-execution');
      }
    } else {
      console.error(`Unknown demo type: ${demoType}`);
      console.error('Available options: api, workflow');
      console.error('Usage examples:');
      console.error('  node run-demo.js api');
      console.error('  node run-demo.js api --explore');
      console.error('  node run-demo.js workflow --workflow="text2img" --prompt="beautiful landscape" --execute=true');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error running demo:', error);
    process.exit(1);
  }
}

// Execute the demo
runDemo(); 