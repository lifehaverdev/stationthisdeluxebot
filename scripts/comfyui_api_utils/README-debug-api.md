# ComfyUI Deploy API Debug Tool

This enhanced debugging tool helps diagnose issues with the ComfyUI Deploy API, especially when receiving HTML responses instead of expected JSON.

## Features

- Tests API endpoints with detailed instrumentation
- Analyzes HTML responses to identify authentication issues
- Tests different HTTP headers to find optimal configuration
- Tests URL formatting variations (trailing slashes, path formats)
- Creates detailed reports with color-coded output
- Saves all responses to files for later inspection
- Provides recommendations to fix common issues

## Installation

Make sure you have the required dependencies:

```bash
npm install dotenv node-fetch jsdom chalk table
```

## Usage

1. Create a `.env` file with your API credentials:
```
COMFY_DEPLOY_API_KEY=your_api_key_here
COMFY_DEPLOY_API_URL=https://api.comfydeploy.com/api
```

2. Run the script with various options:

```powershell
# Basic test of all endpoints
node debug-api-enhanced.js

# Test a specific endpoint
node debug-api-enhanced.js --endpoint=/workflows

# Run all test modes on a specific endpoint
node debug-api-enhanced.js --endpoint=/workflows --mode=all

# Test different HTTP headers
node debug-api-enhanced.js --endpoint=/workflows --mode=headers

# Test URL format variations
node debug-api-enhanced.js --endpoint=/workflows --mode=slash

# Trace request/response flow
node debug-api-enhanced.js --endpoint=/workflows --mode=trace
```

## Test Modes

- `basic`: Standard request with detailed response analysis
- `headers`: Tests various HTTP header combinations
- `slash`: Tests URL format variations (with/without trailing slashes)
- `trace`: Analyzes request flow including redirects
- `all`: Runs all test modes

## Output

The script creates a `debug-output` directory with all responses saved as files:
- JSON responses saved with `.json` extension
- HTML responses saved with `.html` extension

Each file is timestamped and includes the endpoint name for easy reference.

## Common Issues & Solutions

1. **HTML Login Page Instead of JSON**
   - Verify your API key is valid and not expired
   - Check authentication headers are correct
   - Try different Accept headers

2. **Redirect Issues**
   - Check if the API URL has changed
   - Verify subdomain and path are correct
   - Check for SSL/TLS requirements

3. **Error Pages**
   - Examine the HTML content for error messages
   - Check status codes and response headers
   - Verify endpoint path format 