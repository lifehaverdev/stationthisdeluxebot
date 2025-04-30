/**
 * Inspect API Response
 * 
 * This script makes requests to the ComfyUI Deploy API endpoints
 * and inspects HTML responses when JSON is expected.
 * Use this to debug API connectivity issues.
 */

// Load environment variables from .env
require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');

// Get API key from environment
const API_KEY = process.env.COMFY_DEPLOY_API_KEY;
const API_URL = process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com';

if (!API_KEY) {
  console.error('ERROR: COMFY_DEPLOY_API_KEY not found in .env file');
  process.exit(1);
}

/**
 * Make a request to an API endpoint and process the response
 * @param {string} endpoint - API endpoint to request
 * @param {string} method - HTTP method (GET, POST, etc.)
 */
async function inspectEndpoint(endpoint, method = 'GET') {
  console.log(`\n===== INSPECTING ENDPOINT: ${endpoint} (${method}) =====\n`);
  
  try {
    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    console.log(`Making ${method} request to: ${url}`);
    
    const response = await fetch(url, {
      method: method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    });
    
    console.log(`Response status: ${response.status} ${response.statusText}`);
    console.log(`Response headers:`, response.headers.raw());
    
    // Get content type
    const contentType = response.headers.get('content-type') || '';
    console.log(`Content type: ${contentType}`);
    
    // Read the response
    const responseText = await response.text();
    
    // Check if it's JSON
    let isJson = contentType.includes('application/json');
    
    if (isJson) {
      try {
        const jsonData = JSON.parse(responseText);
        console.log('Response is valid JSON:');
        console.log(JSON.stringify(jsonData, null, 2).substring(0, 1000) + (JSON.stringify(jsonData, null, 2).length > 1000 ? '...' : ''));
      } catch (error) {
        console.log('Response claimed to be JSON but failed to parse:');
        console.error(error.message);
        isJson = false;
      }
    }
    
    // If not JSON, handle as HTML
    if (!isJson) {
      console.log('Response appears to be HTML. Summary:');
      
      // Save full response to file for inspection
      const filename = `response-${endpoint.replace(/[^a-zA-Z0-9]/g, '-')}.html`;
      fs.writeFileSync(filename, responseText);
      console.log(`Full response saved to ${filename}`);
      
      // Extract title
      const titleMatch = responseText.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        console.log(`Page title: ${titleMatch[1]}`);
      }
      
      // Extract h1 headings
      const h1Matches = responseText.match(/<h1[^>]*>(.*?)<\/h1>/gi);
      if (h1Matches && h1Matches.length > 0) {
        console.log('H1 Headings:');
        h1Matches.forEach(match => {
          const content = match.replace(/<[^>]*>/g, '');
          console.log(`- ${content}`);
        });
      }
      
      // Look for error messages
      const errorMatches = responseText.match(/error|exception|unauthorized|forbidden|not found/gi);
      if (errorMatches && errorMatches.length > 0) {
        console.log('Possible error indicators found in content');
      }
      
      // Check for login forms
      const loginFormExists = responseText.includes('login') || 
                             responseText.includes('sign in') || 
                             responseText.includes('password');
      if (loginFormExists) {
        console.log('Page appears to contain login-related content - possible authentication issue');
      }
      
      // Extract a small preview
      console.log('\nHTML Preview (first 500 characters):');
      console.log(responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
    }
  } catch (error) {
    console.error(`Error inspecting endpoint ${endpoint}:`, error.message);
  }
}

/**
 * Main function to test various endpoints
 */
async function main() {
  console.log('COMFYUI DEPLOY API RESPONSE INSPECTOR');
  console.log('=====================================');
  console.log(`API URL: ${API_URL}`);
  console.log(`API Key (first 10 chars): ${API_KEY.substring(0, 10)}...`);
  
  // Test various endpoints
  const endpoints = [
    // Root endpoint
    '/',
    
    // Raw endpoints
    '/deployments',
    '/deployment',
    '/workflows',
    '/workflow',
    '/machines',
    
    // With API prefix
    '/api/deployments',
    '/api/deployment',
    '/api/workflows',
    '/api/workflow',
    '/api/machines',
    
    // Try with v1 prefix
    '/v1/deployments',
    '/v1/workflows'
  ];
  
  for (const endpoint of endpoints) {
    await inspectEndpoint(endpoint);
  }
  
  console.log('\nInspection complete.');
}

// Run the script
main().catch(error => {
  console.error('Script failed:', error);
}); 