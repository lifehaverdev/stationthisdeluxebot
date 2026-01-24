/**
 * Quick test script for ComfyDeploy API
 * Usage: ./run-with-env.sh node scripts/test-comfydeploy.js
 */

const axios = require('axios');

const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com/api/volume/model';

async function testUpload() {
  const apiKey = process.env.COMFY_DEPLOY_API_KEY;
  
  if (!apiKey) {
    console.error('COMFY_DEPLOY_API_KEY not set');
    process.exit(1);
  }
  
  console.log('API Key present:', apiKey.slice(0, 8) + '...');
  
  // Try direct link approach instead of huggingface source
  const payload = {
    source: 'link',
    folderPath: 'loras',
    filename: 'ru-neo-697358.safetensors',
    downloadLink: 'https://huggingface.co/ms2stationthis/ru_neo/resolve/main/ru_neo.safetensors'
  };
  
  console.log('\nSending payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\nPOST', COMFY_DEPLOY_API_URL);
  
  try {
    const response = await axios.post(COMFY_DEPLOY_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('\n✅ Success! Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (err) {
    console.log('\n❌ Failed! Status:', err.response?.status);
    console.log('Response data:', JSON.stringify(err.response?.data, null, 2));
    console.log('Error message:', err.message);
  }
}

testUpload();
