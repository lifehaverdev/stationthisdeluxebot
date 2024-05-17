
const http = require("http");
const Jimp = require('jimp');
const fs = require('fs');
const bot = require('../bot')
//const fetch = require('fetch');
const { addWaterMark } = require('../utils/waterMark');
const defaultPrompt = require('../utils/defaultPrompt')
const comfydeployid = "42106fbe-e6b5-4bcd-901f-a69554da084a"
// Function to handle sending the generated image

function getBasePromptByName(name) {
    const promptObj = basepromptmenu.find(prompt => prompt.name === name);
    return promptObj ? promptObj.baseprompt : defaultPrompt;
}

// Function to make the API request and handle the response
async function generateImg2Vid(message, promptObj) {

    try {

        let run_id;
        const response = await fetch("https://www.comfydeploy.com/api/run", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
            },
            body: JSON.stringify({
                deployment_id: comfydeployid,
                webhook: "http://localhost:3000/api/webhook", // optional
                inputs: {
                    "input_image": promptObj.fileUrl,
                }
            }),
        });

        if (response.ok) {
            const data = await response.json();
            ( run_id ) = data.run_id;
            //console.log('runid',run_id);
            return run_id;
        } else {
            console.error('Failed to fetch:', response.statusText);
        }
        
    } catch (error) {
        console.error("Error generating image:", error);
    }

}

async function fetchMS3Output(run_id) {
    const response = await fetch(`https://www.comfydeploy.com/api/run?run_id=${run_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
        },
    });

    if (response.ok) {
        const data = await response.json();
        console.log(`Response data:`, JSON.stringify(data)); // Log the entire data object for debugging

        if (!data) {
            console.error('No data received from the API');
            return null;
        }

        console.log(`Run_ID: ${run_id} Progress: ${(data.progress * 100).toFixed(2)}% - Status: ${data.status}`);

        if (
            data.status === 'success' || 
            data.status === 'failed' || 
            data.status === 'running' || 
            data.status === 'queued' || 
            data.status === 'uploading' || 
            data.status === 'started' || 
            data.status === 'not-started' ||
            data.status === 'timeout'
        ) {
            const output = {
                progress: data.progress,
                status: data.status,
                imgUrl: ''
            };

            // if (data.outputs && data.outputs.length > 0 && data.outputs[0].data) {
            //     const stuffData = data.outputs[0].data;
            //     console.log('stuffData',stuffData)
            //     if (stuffData.gifs && stuffData.gifs.length > 0 && data.status == 'success') {
            //         output.imgUrl = stuffData.gifs[0].url;
            //         console.log('Image URL:', output.imgUrl);
            //         return output;
            //     }
            // } else 
            if (data.outputs && data.outputs.length > 0 && data.outputs[0].data) {
                const stuffData = data.outputs[0].data;
                console.log(stuffData)
                if (stuffData.gifs && stuffData.gifs.length > 0 && data.status == 'success') {
                    output.imgUrl = stuffData.gifs[0].url;
                    console.log('Image URL:', output.imgUrl);
                    return output;
                }
            }

            return output;

            
        } else {
            console.error('Invalid workflow status:', response);
            return {
                progress: -1,
                status: 'indeterminate',
                imgUrl: ''
            };
        }
    } else {
        console.error('Failed to fetch workflow status:', response.statusText);
        console.log(response);
        return {
            progress: -1,
            status: 'indeterminate',
            imgUrl: ''
        };
    }
}



async function checkProgress(run_id) {
    let progress = 0;
    let status = 'not-started';
    let imageUrl = null;
    let timeTaken = null;

    while (true) {
        const output = await fetchWorkflowOutput(run_id);

        if (output) {
            const { progress: currentProgress, status: currentStatus, stuff: theStuff, created_at, ended_at } = output;
            
            if (currentProgress !== undefined) {
                progress = currentProgress;
            }

            if (currentStatus !== undefined) {
                status = currentStatus;
            }

            if (theStuff && theStuff.length > 0 && theStuff[0].data && theStuff[0].data.images && theStuff[0].data.images.length > 0) {
                imageUrl = theStuff[0].data.images[0].url;
            }

            console.log(`Progress: ${(progress * 100).toFixed(2)}% - Status: ${status}; Image URL: ${imageUrl || 'not yet available'}`);

            if (status === 'completed' || status === 'success' || status === 'failed') {
                break;
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Polling interval of 5 seconds
            }
        } else {
            console.error('Failed to fetch workflow output.');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Retry after 5 seconds
        }
    }

    if (imageUrl && created_at && ended_at) {
        const startTime = new Date(created_at);
        const endTime = new Date(ended_at);
        timeTaken = (endTime - startTime) / 1000; // Time taken in seconds

        console.log('Workflow completed! Image URL:', imageUrl);
        console.log('Time taken:', timeTaken.toFixed(2), 'seconds');

        // Return imageUrl and timeTaken
        return {
            imageUrl,
            timeTaken
        };
    } else {
        console.log('Workflow not completed.');
        return null;
    }
}
module.exports = {
    //sendGeneratedImage,
    generateImg2Vid,
    fetchMS3Output
}