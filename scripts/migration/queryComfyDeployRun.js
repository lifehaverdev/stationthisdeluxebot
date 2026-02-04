/**
 * queryComfyDeployRun.js - Query ComfyDeploy API to get run details including seed
 */

const runId = 'ad42cb6b-bfe8-4025-b8a0-67d6fa12ec13';

const apiKey = process.env.COMFY_DEPLOY_API_KEY;

if (!apiKey) {
  console.error('COMFY_DEPLOY_API_KEY not set');
  process.exit(1);
}

(async function main() {
  console.log('\n=== Querying ComfyDeploy for run details ===\n');
  console.log('Run ID:', runId);

  const url = `https://api.comfydeploy.com/api/run/${runId}`;

  console.log('URL:', url);
  console.log('\nFetching...\n');

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Status:', response.status, response.statusText);

    if (!response.ok) {
      const text = await response.text();
      console.log('Error response:', text);
      return;
    }

    const data = await response.json();

    console.log('\n=== FULL RESPONSE ===\n');
    console.log(JSON.stringify(data, null, 2));

    // Try to find seed in common locations
    console.log('\n=== LOOKING FOR SEED ===\n');

    if (data.inputs) {
      console.log('Inputs:', JSON.stringify(data.inputs, null, 2));
    }

    if (data.workflow_inputs) {
      console.log('Workflow Inputs:', JSON.stringify(data.workflow_inputs, null, 2));
    }

    if (data.run_log) {
      console.log('Run Log:', JSON.stringify(data.run_log, null, 2));
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
})();
