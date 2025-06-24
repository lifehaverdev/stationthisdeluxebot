/**
 * Debug script for ComfyUI Deploy API responses
 * 
 * This script helps diagnose issues when receiving HTML responses
 * instead of expected JSON from the API endpoints.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');

// Constants
const API_URL = process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com';
const API_KEY = process.env.COMFY_DEPLOY_API_KEY;

// API Endpoints to test
const ENDPOINTS = {
  WORKFLOWS: '/api/workflows',
  DEPLOYMENTS: '/api/deployments',
  MACHINES: '/api/machines'
};

// Helper to get arguments from command line
function getArgValue(name, defaultValue) {
  const arg = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (arg) {
    return arg.split('=')[1];
  }
  return defaultValue;
}

// Enhanced logging with timestamps
function log(level, message, details = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  console.log(`${prefix} ${message}`);
  if (details) {
    console.log(`${' '.repeat(prefix.length + 1)}`, details);
  }
}

// Save response to file
function saveResponseToFile(endpoint, response, isHtml = false) {
  const dir = path.join(process.cwd(), 'debug-output');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const sanitizedEndpoint = endpoint.replace(/\//g, '-').replace(/^-/, '');
  const extension = isHtml ? 'html' : 'json';
  const filename = path.join(dir, `${sanitizedEndpoint}.${extension}`);
  
  fs.writeFileSync(filename, response);
  log('info', `Response saved to ${filename}`);
}

// Function to test an endpoint
async function testEndpoint(endpoint) {
  log('info', `Testing endpoint: ${API_URL}${endpoint}`);
  
  try {
    // Make request with Accept header for both JSON and HTML to see what we get
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json, text/html'
      }
    });
    
    const contentType = response.headers.get('content-type') || '';
    log('info', `Response status: ${response.status} ${response.statusText}`);
    log('info', `Content-Type: ${contentType}`);
    
    // Get the raw response as text first
    const responseText = await response.text();
    
    // Check if response is HTML
    const isHtml = contentType.includes('text/html') || responseText.trim().startsWith('<!DOCTYPE html>');
    
    if (isHtml) {
      log('warn', `Received HTML response instead of JSON!`);
      // Save HTML response for inspection
      saveResponseToFile(endpoint, responseText, true);
      
      // Extract useful information from HTML if possible
      const titleMatch = responseText.match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        log('info', `HTML Title: ${titleMatch[1]}`);
      }
      
      // Look for error messages
      const errorMatch = responseText.match(/class=['"]message['"]>(.*?)<\//);
      if (errorMatch) {
        log('error', `Error message from HTML: ${errorMatch[1]}`);
      }
    } else {
      // It's probably JSON, try to parse it
      try {
        const jsonData = JSON.parse(responseText);
        log('info', `Successfully received JSON response with ${Array.isArray(jsonData) ? jsonData.length : 'N/A'} items`);
        
        // Save JSON for inspection
        saveResponseToFile(endpoint, JSON.stringify(jsonData, null, 2));
        
        // Print first item for reference
        if (Array.isArray(jsonData) && jsonData.length > 0) {
          log('info', `First item example:`, jsonData[0]);
        }
      } catch (parseError) {
        log('error', `Received non-HTML response but couldn't parse as JSON: ${parseError.message}`);
        // Save raw response
        saveResponseToFile(endpoint, responseText);
      }
    }
    
    // Log all headers for debugging
    log('info', `Response Headers:`, Object.fromEntries([...response.headers.entries()]));
    
  } catch (error) {
    log('error', `Error testing endpoint ${endpoint}: ${error.message}`);
  }
}

// Function to try with different Accept headers
async function testWithDifferentHeaders(endpoint) {
  const headerSets = [
    { 'Accept': 'application/json' },
    { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    { 'Accept': '*/*' },
    {} // No Accept header
  ];
  
  for (const [index, headers] of headerSets.entries()) {
    log('info', `\nTest #${index + 1}: Testing ${endpoint} with headers:`, headers);
    
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          ...headers
        }
      });
      
      const contentType = response.headers.get('content-type') || '';
      log('info', `Response status: ${response.status} ${response.statusText}`);
      log('info', `Content-Type: ${contentType}`);
      
      // Get the raw response
      const responseText = await response.text();
      
      // Save the response for comparison
      const filename = `${endpoint.replace(/\//g, '-').replace(/^-/, '')}-test-${index + 1}`;
      saveResponseToFile(filename, responseText, contentType.includes('text/html'));
      
    } catch (error) {
      log('error', `Error in test #${index + 1}: ${error.message}`);
    }
  }
}

// Function to test URL with and without trailing slash
async function testWithAndWithoutSlash(endpoint) {
  const endpointsToTest = [
    endpoint,                          // Original
    endpoint + '/',                    // With trailing slash
    endpoint.replace(/^\/api/, ''),    // Without /api prefix
    endpoint.replace(/^\/api/, '') + '/' // Without /api prefix and with trailing slash
  ];
  
  for (const [index, testEndpoint] of endpointsToTest.entries()) {
    log('info', `\nSlash Test #${index + 1}: Testing URL: ${API_URL}${testEndpoint}`);
    
    try {
      const response = await fetch(`${API_URL}${testEndpoint}`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json'
        }
      });
      
      const contentType = response.headers.get('content-type') || '';
      log('info', `Response status: ${response.status} ${response.statusText}`);
      log('info', `Content-Type: ${contentType}`);
      
      // Save response for inspection
      const responseText = await response.text();
      const filename = `${testEndpoint.replace(/\//g, '-').replace(/^-/, '')}-slash-test-${index + 1}`;
      saveResponseToFile(filename, responseText, contentType.includes('text/html'));
      
    } catch (error) {
      log('error', `Error in slash test #${index + 1}: ${error.message}`);
    }
  }
}

// Main function to run the tests
async function runTests() {
  // Ensure API key is set
  if (!API_KEY) {
    log('error', 'COMFY_DEPLOY_API_KEY environment variable not set. Please set it before running this script.');
    process.exit(1);
  }
  
  log('info', '==============================================');
  log('info', '   COMFYUI DEPLOY API DEBUG SCRIPT');
  log('info', '==============================================');
  log('info', `Using API URL: ${API_URL}`);
  log('info', '==============================================\n');
  
  // Get endpoint to test from command line
  const targetEndpoint = getArgValue('endpoint', null);
  const testMode = getArgValue('mode', 'basic'); // basic, headers, slash, all
  
  if (targetEndpoint) {
    log('info', `Testing specific endpoint: ${targetEndpoint}`);
    
    if (testMode === 'basic' || testMode === 'all') {
      await testEndpoint(targetEndpoint);
    }
    
    if (testMode === 'headers' || testMode === 'all') {
      await testWithDifferentHeaders(targetEndpoint);
    }
    
    if (testMode === 'slash' || testMode === 'all') {
      await testWithAndWithoutSlash(targetEndpoint);
    }
  } else {
    // Test all endpoints
    log('info', 'Testing all endpoints...\n');
    
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      log('info', `\n==== Testing ${name} endpoint ====\n`);
      
      if (testMode === 'basic' || testMode === 'all') {
        await testEndpoint(endpoint);
      }
      
      if (testMode === 'headers' || testMode === 'all') {
        await testWithDifferentHeaders(endpoint);
      }
      
      if (testMode === 'slash' || testMode === 'all') {
        await testWithAndWithoutSlash(endpoint);
      }
    }
  }
  
  log('info', '\nAll tests completed. Check the debug-output directory for saved responses.');
}

// Check for raw HTML flag
const printRawHtml = getArgValue('raw-html', 'false') === 'true';

// Run the tests
runTests().catch(error => {
  log('error', `Test script failed with error: ${error.message}`);
}); 