#!/usr/bin/env node

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const chalk = require('chalk');
const { table } = require('table');
const { execSync } = require('child_process');
const { URL } = require('url');

// API Configuration
const API_KEY = process.env.COMFY_DEPLOY_API_KEY;
const API_URL = process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com/api';

// Common endpoints to test
const ENDPOINTS = {
  workflows: '/workflows',
  tokens: '/tokens',
  token: '/token',
  runs: '/runs',
  deployWorkflows: '/comfyui-deploy-workflows'
};

// Create output directory if it doesn't exist
const OUTPUT_DIR = path.join(__dirname, 'debug-output');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Logging utility with timestamp and color
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const colorMap = {
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green
  };
  
  const colorFn = colorMap[level] || chalk.white;
  console.log(`${chalk.gray(timestamp)} ${colorFn(message)}`);
}

// Save response to file
function saveResponseToFile(response, endpoint, contentType, mode = 'basic') {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const sanitizedEndpoint = endpoint.replace(/\//g, '-').replace(/^-/, '');
  const extension = contentType.includes('json') ? 'json' : 'html';
  const filename = `${timestamp}-${sanitizedEndpoint}-${mode}.${extension}`;
  const filepath = path.join(OUTPUT_DIR, filename);
  
  fs.writeFileSync(filepath, response);
  log(`Response saved to ${filepath}`, 'success');
  return filepath;
}

// Analyze HTML content in detail
async function analyzeHtmlContent(html, endpoint) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Extract important data
    const title = document.title;
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => `${h.tagName}: ${h.textContent.trim()}`);
    
    // Look for error messages
    const errorElements = Array.from(document.querySelectorAll('.error, .alert, .alert-danger, [class*="error"]'))
      .map(e => e.textContent.trim());
    
    // Look for forms and their action URLs
    const forms = Array.from(document.querySelectorAll('form'))
      .map(form => ({
        action: form.getAttribute('action'),
        method: form.getAttribute('method'),
        inputs: Array.from(form.querySelectorAll('input[name]'))
          .map(input => input.getAttribute('name'))
      }));
    
    // Check for links to relevant pages
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href')
      }))
      .filter(link => 
        link.href.includes('login') || 
        link.href.includes('auth') || 
        link.href.includes('api') ||
        link.href.includes('token')
      );
    
    // Look for scripts that might provide clues
    const scripts = Array.from(document.querySelectorAll('script'))
      .map(script => script.getAttribute('src'))
      .filter(Boolean);
    
    // Check for redirect meta tags
    const redirectMeta = document.querySelector('meta[http-equiv="refresh"]');
    const redirectUrl = redirectMeta ? redirectMeta.getAttribute('content') : null;
    
    // Check for HTTP status codes in the HTML
    const statusCodeMatch = html.match(/status code (\d+)/i) || html.match(/(\d{3}) error/i);
    const statusCode = statusCodeMatch ? statusCodeMatch[1] : null;
    
    return {
      title,
      headings,
      errorMessages: errorElements,
      forms,
      links,
      scripts,
      redirectUrl,
      statusCode,
      length: html.length,
      isLoginPage: 
        title.toLowerCase().includes('login') || 
        html.toLowerCase().includes('login') ||
        html.toLowerCase().includes('sign in') ||
        forms.some(form => 
          (form.action && form.action.includes('login')) ||
          form.inputs.includes('password')
        )
    };
  } catch (error) {
    log(`Error analyzing HTML: ${error.message}`, 'error');
    return { error: error.message };
  }
}

// Make an HTTP request with better instrumentation
async function makeRequest(endpoint, mode = 'basic', options = {}) {
  const startTime = performance.now();
  const url = `${API_URL}${endpoint}`;
  
  // Default headers
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  log(`Testing endpoint: ${chalk.cyan(url)} (Mode: ${mode})`, 'info');
  
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      ...options
    });
    
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    const contentType = response.headers.get('content-type') || '';
    const status = response.status;
    const statusText = response.statusText;
    
    // Log response metadata
    log(`Response: ${status} ${statusText} (${duration}ms)`, 
      status >= 200 && status < 300 ? 'success' : 'warn');
    log(`Content-Type: ${contentType}`, 'info');
    
    // Get response text
    const responseText = await response.text();
    
    // Save response to file
    const filepath = saveResponseToFile(responseText, endpoint, contentType, mode);
    
    // Process based on content type
    if (contentType.includes('json')) {
      try {
        const jsonData = JSON.parse(responseText);
        return {
          success: true,
          status,
          duration,
          contentType,
          data: jsonData,
          filepath
        };
      } catch (error) {
        log(`Error parsing JSON: ${error.message}`, 'error');
        return {
          success: false,
          status,
          duration,
          contentType,
          error: 'Invalid JSON response',
          raw: responseText,
          filepath
        };
      }
    } else if (contentType.includes('html')) {
      const analysis = await analyzeHtmlContent(responseText, endpoint);
      
      // Log HTML analysis
      log(`HTML Page Title: ${analysis.title}`, 'info');
      if (analysis.isLoginPage) {
        log('Response appears to be a login page', 'warn');
      }
      if (analysis.errorMessages.length > 0) {
        log(`Found error messages: ${analysis.errorMessages.join(', ')}`, 'error');
      }
      
      return {
        success: false,
        status,
        duration,
        contentType,
        error: 'HTML response instead of JSON',
        htmlAnalysis: analysis,
        filepath
      };
    } else {
      return {
        success: false,
        status,
        duration,
        contentType,
        error: `Unexpected content type: ${contentType}`,
        raw: responseText,
        filepath
      };
    }
  } catch (error) {
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    // Analyze network errors in more detail
    let errorType = 'Unknown';
    let recommendation = '';
    
    if (error.code === 'ENOTFOUND') {
      errorType = 'DNS Resolution Failure';
      recommendation = 'Check if the API hostname is correct.';
    } else if (error.code === 'ECONNREFUSED') {
      errorType = 'Connection Refused';
      recommendation = 'The server actively refused the connection. Check if the service is running and the port is correct.';
    } else if (error.code === 'ETIMEDOUT') {
      errorType = 'Connection Timeout';
      recommendation = 'The request timed out. Check your network connection or the server might be overloaded.';
    } else if (error.code === 'ECONNRESET') {
      errorType = 'Connection Reset';
      recommendation = 'The connection was reset by the server. This could indicate a server-side issue.';
    } else if (error.message.includes('certificate')) {
      errorType = 'SSL/TLS Certificate Error';
      recommendation = 'There might be an issue with the SSL certificate. Check if the certificate is valid.';
    }
    
    log(`${errorType}: ${error.message}`, 'error');
    if (recommendation) {
      log(`Recommendation: ${recommendation}`, 'info');
    }
    
    return {
      success: false,
      error: error.message,
      errorType,
      recommendation,
      duration
    };
  }
}

// Test with different headers
async function testWithDifferentHeaders(endpoint) {
  const headerCombinations = [
    { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' },
    { 'Authorization': `Bearer ${API_KEY}`, 'Accept': '*/*' },
    { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    { 'Authorization': `Key ${API_KEY}`, 'Accept': 'application/json' },
    { 'X-API-Key': API_KEY, 'Accept': 'application/json' },
    { 'Authorization': `Token ${API_KEY}`, 'Accept': 'application/json' }
  ];
  
  const results = [];
  
  for (const headers of headerCombinations) {
    log(`Testing with headers: ${Object.keys(headers).join(', ')}`, 'info');
    const result = await makeRequest(endpoint, 'headers', { headers });
    results.push({
      headers: JSON.stringify(headers),
      status: result.status,
      success: result.success,
      contentType: result.contentType || 'N/A',
      error: result.error || 'None'
    });
  }
  
  // Display results in a table
  const tableData = [
    ['Headers', 'Status', 'Success', 'Content-Type', 'Error'],
    ...results.map(r => [
      r.headers, 
      r.status || 'Error', 
      r.success ? 'Yes' : 'No', 
      r.contentType, 
      r.error
    ])
  ];
  
  console.log(table(tableData));
  return results;
}

// Test URL formats (with/without trailing slash)
async function testUrlFormats(endpoint) {
  const formats = [
    endpoint,
    endpoint.endsWith('/') ? endpoint.slice(0, -1) : `${endpoint}/`,
    endpoint.startsWith('/') ? endpoint.substring(1) : `/${endpoint}`
  ];
  
  const results = [];
  
  for (const format of formats) {
    log(`Testing URL format: ${format}`, 'info');
    const result = await makeRequest(format, 'slash');
    results.push({
      format,
      status: result.status,
      success: result.success,
      contentType: result.contentType || 'N/A',
      error: result.error || 'None'
    });
  }
  
  // Display results in a table
  const tableData = [
    ['URL Format', 'Status', 'Success', 'Content-Type', 'Error'],
    ...results.map(r => [
      r.format, 
      r.status || 'Error', 
      r.success ? 'Yes' : 'No', 
      r.contentType, 
      r.error
    ])
  ];
  
  console.log(table(tableData));
  return results;
}

// Trace route analysis for diagnostics
async function traceRequest(endpoint) {
  try {
    const url = new URL(`${API_URL}${endpoint}`);
    const host = url.hostname;
    
    log(`Performing trace route analysis to ${host}...`, 'info');
    
    // Use tracert on Windows or traceroute on Unix
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `tracert -h 15 ${host}` : `traceroute -m 15 ${host}`;
    
    const result = execSync(command).toString();
    const outputFile = path.join(OUTPUT_DIR, `traceroute-${host}-${Date.now()}.txt`);
    fs.writeFileSync(outputFile, result);
    
    log(`Trace route results saved to ${outputFile}`, 'success');
    return { success: true, filepath: outputFile };
  } catch (error) {
    log(`Error performing trace route: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

// Main function
async function runTests() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let selectedEndpoint = null;
  let mode = 'basic';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--endpoint' && args[i + 1]) {
      selectedEndpoint = args[i + 1];
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i++;
    }
  }
  
  // Display API configuration
  log('Starting ComfyUI Deploy API diagnostics', 'info');
  log(`API URL: ${API_URL}`, 'info');
  log(`API Key: ${API_KEY ? '****' + API_KEY.slice(-4) : 'Not set'}`, 'info');
  
  if (!API_KEY) {
    log('ERROR: COMFY_DEPLOY_API_KEY is not set in .env file', 'error');
    process.exit(1);
  }
  
  // Determine endpoints to test
  const endpointsToTest = [];
  
  if (selectedEndpoint) {
    endpointsToTest.push(selectedEndpoint);
  } else {
    endpointsToTest.push(...Object.values(ENDPOINTS));
  }
  
  log(`Testing ${endpointsToTest.length} endpoints with mode: ${mode}`, 'info');
  
  // Run tests
  for (const endpoint of endpointsToTest) {
    log(`\n${chalk.cyan('=')}${chalk.white('=')}${chalk.cyan('=')} Testing endpoint: ${chalk.cyan(endpoint)} ${'='.repeat(30)}`, 'info');
    
    if (mode === 'basic' || mode === 'all') {
      await makeRequest(endpoint, 'basic');
    }
    
    if (mode === 'headers' || mode === 'all') {
      await testWithDifferentHeaders(endpoint);
    }
    
    if (mode === 'slash' || mode === 'all') {
      await testUrlFormats(endpoint);
    }
    
    if (mode === 'trace' || mode === 'all') {
      await traceRequest(endpoint);
    }
  }
  
  log('\nAPI diagnostics completed. Check the debug-output directory for detailed results.', 'success');
}

// Run the tests
runTests().catch(error => {
  log(`Unhandled error: ${error.message}`, 'error');
  log(error.stack, 'error');
  process.exit(1);
}); 