const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const WebSocket = require('ws');
const test = false;
/**
 * Uploads an image to Tripo3D API
 * @param {Buffer} imageBuffer - The image file buffer
 * @param {string} apiKey - The Tripo3D API key
 */
// Helper function for conditional logging
function debugLog(message) {
    if (test) {
        console.log(message);
    }
}

async function uploadImage(imagePath) {
    const apiKey = process.env.TRIPO
    try {
        debugLog('Starting image upload to Tripo3D API');
        debugLog(`Reading file from path: ${imagePath}`);
        
        // Read the file into a buffer
        const imageBuffer = await fs.promises.readFile(imagePath);
        
        const url = "https://api.tripo3d.ai/v2/openapi/upload";
        const formData = new FormData();
        
        debugLog('Creating form data with image buffer');
        // Use the actual filename from the path
        const filename = path.basename(imagePath);
        formData.append('file', imageBuffer, {
            filename: filename,
            contentType: 'image/jpeg'
        });

        debugLog('Sending POST request to upload endpoint');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        if (!response.ok) {
            debugLog('Upload request failed');
            const responseText = await response.text();
            throw new Error(`Error uploading image: ${response.statusText}`);
        }

        debugLog('Upload successful, parsing response');
        const data = await response.json();
        debugLog(`Received image token: ${data.data.image_token}`);
        return {
            success: true,
            imageToken: data.data.image_token
        };

    } catch (error) {
        debugLog(`Upload failed with error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

async function generateModel(imageToken) {
    const apiKey = process.env.TRIPO
    try {
        debugLog('Starting model generation with image token');
        const url = "https://api.tripo3d.ai/v2/openapi/task";
        
        const data = {
            type: 'image_to_model',
            file: {
                type: 'jpg',
                file_token: imageToken
            },
            model_version: 'default',
            texture: true,
            pbr: true
        };
        debugLog('Sending POST request to generate model');
        debugLog(`Request URL: ${url}`);
        debugLog(`Request headers: ${JSON.stringify({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.substring(0,8)}...`
        }, null, 2)}`);
        debugLog(`Request body: ${JSON.stringify(data, null, 2)}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(data)
        });

        debugLog(`Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            debugLog('Model generation request failed');
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        debugLog('Model generation request successful, parsing response');
        const responseData = await response.json();
        debugLog(`Received task ID: ${responseData.data.task_id}`);
        return {
            success: true,
            taskId: responseData.data.task_id
        };

    } catch (error) {
        debugLog(`Model generation failed with error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

async function receiveOne(taskId, apiKey) {
    debugLog(`Starting WebSocket connection for task ${taskId}`);
    return new Promise((resolve, reject) => {
        const url = `wss://api.tripo3d.ai/v2/openapi/task/watch/${taskId}`;
        const headers = {
            Authorization: `Bearer ${apiKey}`
        };

        debugLog('Creating WebSocket connection');
        const ws = new WebSocket(url, { headers });

        ws.on('message', async (message) => {
            try {
                debugLog('Received WebSocket message');
                const data = JSON.parse(message);
                const status = data.data.status;
                debugLog(`Task status: ${status}`);
                
                if (status === 'success') {
                    debugLog('Task completed successfully');
                    ws.close();
                    resolve(data);
                } else if (status !== 'running' && status !== 'queued') {
                    debugLog(`Task ended with status: ${status}`);
                    ws.close();
                    resolve(data);
                }
            } catch (err) {
                debugLog(`WebSocket message handling error: ${err.message}`);
                ws.close();
                reject(err);
            }
        });

        ws.on('error', (err) => {
            debugLog(`WebSocket error: ${err.message}`);
            reject(err);
        });
    });
}

async function generateTripo(promptObj, processWaitlist) {
    try {
        debugLog('Starting Tripo generation process');
        const apiKey = process.env.TRIPO;
        
        // 1. Upload the image first
        console.log('promptObj as seen in generateTripo:', promptObj)
        const uploadResult = await uploadImage(promptObj.imageFile);
        if (!uploadResult.success) {
            debugLog('Image upload failed');
            console.error('Failed to upload image for TRIPO');
            return -1;
        }

        debugLog('Image uploaded successfully, proceeding to model generation');
        // 2. Generate the model using the imageToken from the upload result
        const modelResult = await generateModel(uploadResult.imageToken);
        if (!modelResult.success) {
            debugLog('Model generation failed');
            throw new Error(modelResult.error);
        }

        const response = {
            taskId: modelResult.taskId
        };

        const run_id = response.taskId;
        debugLog(`Received run ID: ${run_id}`);

        // 3. Set up WebSocket connection with proper headers
        debugLog('Setting up WebSocket connection for progress monitoring');
        const url = `wss://api.tripo3d.ai/v2/openapi/task/watch/${run_id}`;
        const ws = new WebSocket(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`
            }
        });

        ws.on('message', (message) => {
            try {
                debugLog('Received WebSocket message (raw):');
                debugLog(message.toString());

                const data = JSON.parse(message);
                debugLog('Parsed WebSocket data:');
                debugLog(JSON.stringify(data, null, 2));

                const status = data.data.status;
                debugLog(`Task status: ${status}`);

                // Extract URLs from the result object when status is success
                if (status === 'success' && data.data.result) {
                    const outputs = [];
                    if (data.data.result.model && data.data.result.model.url) {
                        outputs.push({
                            type: 'model',
                            url: data.data.result.model.url
                        });
                    }
                    if (data.data.result.rendered_image && data.data.result.rendered_image.url) {
                        outputs.push({
                            type: 'preview',
                            url: data.data.result.rendered_image.url
                        });
                    }
                    
                    if (typeof processWaitlist === 'function') {
                        processWaitlist(
                            status,
                            run_id,
                            outputs
                        );
                    }
                } else if (typeof processWaitlist === 'function') {
                    processWaitlist(
                        status,
                        run_id,
                        []
                    );
                }

                if (['success', 'failed', 'cancelled'].includes(status)) {
                    debugLog(`Task completed with status: ${status}`);
                    ws.close();
                }
            } catch (err) {
                debugLog(`WebSocket message handling error: ${err.message}`);
                debugLog('Failed to parse message:');
                debugLog(message.toString());
                ws.close();
            }
        });

        ws.on('error', (error) => {
            debugLog(`WebSocket error occurred: ${error.message}`);
            console.error('WebSocket error:', error);
            processWaitlist('failed', run_id, []);
            ws.close();
        });

        return run_id;

    } catch (error) {
        debugLog(`Tripo generation failed with error: ${error.message}`);
        console.error('Error in generateTripo:', error);
        return -1;
    }
}

module.exports = {
    // uploadImage,
    // generateModel,
    // receiveOne
    generateTripo
};