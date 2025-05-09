const express = require('express');
const bodyParser = require('body-parser');
const { getBot } = require('./app');
require('dotenv').config();
const { processWaitlist } = require('./utils/bot/queue');
const { initialize } = require('./utils/bot/intitialize')
const imageRouter = require('./api/index')
//const { createCollectionZip } = require('./db/operations/downloadCollection');
const path = require('path');
const fs = require('fs');

// Helper function for polling (can be moved to a utils file later)
async function pollForComfyOutputsAndProcess(run_id) {
    const maxRetries = 12; // e.g., 12 retries * 5 seconds = 60 seconds timeout
    const retryDelay = 5000; // 5 seconds
    const logPrefix = '~~POLL~~';

    console.log(`${logPrefix} Starting polling for outputs for run_id: ${run_id}`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`${logPrefix} Attempt ${i + 1}/${maxRetries} to fetch outputs for ${run_id}`);
            const response = await fetch(`https://www.comfydeploy.com/api/run?run_id=${run_id}`, {
                method: "GET",
                headers: {
                    "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
                },
            });

            if (!response.ok) {
                console.error(`${logPrefix} Error fetching status for ${run_id}: ${response.status} ${await response.text()}`);
                // If a 404 or other critical error, might stop polling earlier
                if (response.status === 404) {
                    console.error(`${logPrefix} Run ID ${run_id} not found. Stopping polling.`);
                    await processWaitlist('failed', run_id, [{ error: 'Polling: Run ID not found' }]);
                    return;
                }
                // For other server errors, continue retrying up to maxRetries
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            const data = await response.json();
            // console.log(`${logPrefix} Polled data for ${run_id}:`, JSON.stringify(data, null, 2));

            const currentOutputs = data.outputs;
            const currentStatus = data.status;
            const currentLiveStatus = data.live_status;

            // Check if outputs are populated
            // We need to define what "populated" means. For RMBG, we expect one image.
            // A simple check could be if currentOutputs is an array and has items.
            // A more robust check would be to see if it has data.images[0].url
            let foundImageOutput = false;
            if (Array.isArray(currentOutputs) && currentOutputs.length > 0) {
                // Example: Check if any output object has a structure like { data: { images: [ { url: ... } ] } }
                // or simpler { url: ... } if ComfyDeploy flattens it for some tasks.
                // For now, let's assume if outputs array is not empty, it might be okay, or contains the direct URL.
                // The `handleTaskCompletion` will ultimately parse it.
                // The most important thing is that `currentOutputs` is not empty.
                // A specific check for RMBG might look for a single image URL.
                // Let's assume for now any non-empty array is a candidate for processing.
                if (currentOutputs.some(out => out?.data?.images?.some(img => img.url) || out?.url)) {
                    foundImageOutput = true;
                }
            }

            if (foundImageOutput) {
                console.log(`${logPrefix} SUCCESS: Outputs found for ${run_id} after ${i + 1} attempts. LiveStatus: '${currentLiveStatus}'. Outputs:`, JSON.stringify(currentOutputs, null, 2));
                await processWaitlist('success', run_id, currentOutputs);
                return;
            }

            // If status is no longer 'success' or 'running' (or 'started', 'uploading'), stop.
            if (!['success', 'running', 'started', 'uploading'].includes(currentStatus)) {
                console.warn(`${logPrefix} Polling for ${run_id}: Status changed to '${currentStatus}'. LiveStatus: '${currentLiveStatus}'. Stopping polling. Last outputs:`, JSON.stringify(currentOutputs, null, 2));
                // If it failed during polling, update with the failed status.
                // If it succeeded but outputs were still empty by this check, it's a problem.
                await processWaitlist(currentStatus, run_id, currentOutputs); // Pass current status and outputs
                return;
            }

            console.log(`${logPrefix} Outputs not yet populated for ${run_id}. Attempt ${i + 1}/${maxRetries}. Status: '${currentStatus}', LiveStatus: '${currentLiveStatus}'. Retrying in ${retryDelay / 1000}s...`);
        } catch (error) {
            console.error(`${logPrefix} Error during polling attempt for ${run_id}:`, error);
            // Fall through to delay and retry unless it's the last attempt
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    console.error(`${logPrefix} TIMEOUT: Failed to get populated outputs for ${run_id} after ${maxRetries} retries.`);
    await processWaitlist('failed', run_id, [{ error: 'Polling timeout for outputs' }]); // Or a custom timeout status
}

const app = express();
app.use(bodyParser.json());
app.use('/v1/images', imageRouter);
// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});
initialize();

console.log('running server now');

app.get('/api/webhook', (req, res) => {
  console.log('GET /api/webhook: Received a GET request, usually webhooks are POST.');
  res.status(200).send('Webhook endpoint is active. Please use POST for webhook data.');
}); 

app.post('/api/webhook', async (req, res) => {
  try {
    const { status, run_id, outputs } = req.body;
    const logPrefix = '~~⚡~~';

    if (!status || !run_id) {
      console.error(`${logPrefix} Invalid webhook: Missing status or run_id. Body:`, JSON.stringify(req.body));
      return res.status(400).json({ error: 'Invalid request: Missing status or run_id' });
    }
    
    console.log(`${logPrefix} Run ID: ${run_id} Status: ${status}`);

    if (status === 'success') {
        console.log(`Webhook SUCCESS for ${run_id}: Entire req.body:`, JSON.stringify(req.body, null, 2));

        const liveStatus = req.body.live_status;
        const outputsIsEmpty = !outputs || (Array.isArray(outputs) && outputs.length === 0);

        // POLLING LOGIC TRIGGER
        if (outputsIsEmpty && liveStatus && liveStatus.toLowerCase().includes('saveimage')) {
            console.log(`${logPrefix} POLLING TRIGGERED for ${run_id}: Status success, outputs empty, live_status '${liveStatus}'. Starting background polling.`);
            pollForComfyOutputsAndProcess(run_id); // Intentionally not awaited
            return res.status(200).json({ message: "Webhook received, polling for outputs started." });
        } else {
            // Proceed normally if not polling
            console.log(`${logPrefix} Normal processing for ${run_id}. Outputs (or lack thereof) considered final from this webhook.`);
            await processWaitlist(status, run_id, outputs);
        }
    } else {
        // For non-success statuses, process immediately
        // console.log(`Webhook ${status} for ${run_id}: Entire req.body:`, JSON.stringify(req.body, null, 2));
        await processWaitlist(status, run_id, outputs);
    }
    
    // Only send this if not already sent by the polling trigger block
    if (!res.headersSent) {
        res.status(200).json({ message: "Webhook processed." });
    }

  } catch (err) {
    console.error('Exception occurred in /api/webhook:', err);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// app.get('/download/:collectionId', async (req, res) => {
//     try {
//         const collectionId = req.params.collectionId;
//         const collectionPath = path.join(__dirname, 'output', 'testexecs');
//         const zipPath = path.join(__dirname, 'temp', `collection_${collectionId}.zip`);
//         console.log('collectionPath', collectionPath);
//         console.log('zipPath', zipPath);
//         // Create temp directory if it doesn't exist
//         if (!fs.existsSync(path.join(__dirname, 'temp'))) {
//             fs.mkdirSync(path.join(__dirname, 'temp'));
//         }
//         console.log('creating zip file');
//         // Create the zip file
//         await createCollectionZip(collectionPath, zipPath);
//         console.log('zip file created');
//         // Set headers for file download
//         res.setHeader('Content-Type', 'application/zip');
//         res.setHeader('Content-Disposition', `attachment; filename=collection_${collectionId}.zip`);
//         console.log('setting headers');
//         // Stream the file to the response
//         const fileStream = fs.createReadStream(zipPath);
//         console.log('streaming file');
//         fileStream.pipe(res);
//         console.log('file streamed');

//         // Clean up the zip file after sending
//         fileStream.on('end', () => {
//             fs.unlink(zipPath, (err) => {
//                 if (err) console.error('Error cleaning up zip file:', err);
//             });
//         });

//     } catch (error) {
//         console.error('Download error:', error);
//         res.status(500).send('Error creating download');
//     }
// });

// For testing, add a simple download page
// app.get('/download', (req, res) => {
//     res.send(`
//         <html>
//             <body>
//                 <h1>Collection Download Test</h1>
//                 <p>Click the button to download the test collection:</p>
//                 <button onclick="window.location.href='/download/6702415579280'">
//                     Download Collection
//                 </button>
//             </body>
//         </html>
//     `);
// });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

