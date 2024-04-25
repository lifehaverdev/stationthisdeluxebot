
const http = require("http");
const Jimp = require('jimp');
const fs = require('fs');
const bot = require('../bot')
//const fetch = require('fetch');
const { addWaterMark } = require('../utils/waterMark');
const defaultPrompt = require('../utils/defaultPrompt')
const comfydeployid = "8e8cd6c1-fac6-4579-a908-619bf65f5415"
// Function to handle sending the generated image

function getBasePromptByName(name) {
    const promptObj = basepromptmenu.find(prompt => prompt.name === name);
    return promptObj ? promptObj.baseprompt : defaultPrompt;
}

// Function to make the API request and handle the response
async function generateImage(message, promptObj) {

    try {

        promptObj.prompt = promptObj.prompt.replace("/make", "").trim();
        if(promptObj.prompt == ''){
            return;
        }
        // Censored words list (replace with your list of words)
        const censoredWords = ["topless","lingerie","stripper","boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen"];


        // Function to filter out censored words from the prompt
        const filterCensoredWords = (prompt) => {
            return prompt.split(" ").filter(word => !censoredWords.includes(word)).join(" ");
        };
        let censoredPrompt;
        promptObj.whaleMode ? censoredPrompt = promptObj.prompt : censoredPrompt = filterCensoredWords(promptObj.prompt);
        let basePrompt = getBasePromptByName(promptObj.basePrompt);
        let userBasePrompt;
        promptObj.userBasePrompt != '' && promptObj.userPrompt ? userBasePrompt = promptObj.userBasePrompt : userBasePrompt = '';
        let lora = [];
        promptObj.loras && promptObj.loras.length > 0 ? lora.push(promptObj.loras) : null;
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
                    "input_prompt": censoredPrompt + userBasePrompt + basePrompt,
                    "input_steps": promptObj.steps,
                    "input_cfg": promptObj.cfg,
                    "input_width": promptObj.photoStats.width,
                    "input_height": promptObj.photoStats.height,
                    "input_seed": promptObj.seed,
                    // "input_lora_name": lora[0].name,
                    "input_lora_strength": lora[0].strength
                }
            }),
        });

        if (response.ok) {
            const data = await response.json();
            ( run_id ) = data.run_id;
            console.log('runid',run_id);
            return run_id;
        } else {
            console.error('Failed to fetch:', response.statusText);
        }
        
    } catch (error) {
        console.error("Error generating image:", error);
    }

}

async function fetchWorkflowOutput(run_id) {
    const response = await fetch(`https://www.comfydeploy.com/api/run?run_id=${run_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
        },
    });

    if (response.ok) {
        const data = await response.json();
        //console.log(`Response data:`, data); // Log the entire data object for debugging

        if (!data) {
            console.error('No data received from the API');
            return null;
        }

        console.log(`Run_ID: ${run_id} Progress: ${(data.progress * 100).toFixed(2)}% - Status: ${data.status}`);

        if (data.status === 'success' || data.status === 'failed' || data.status === 'running' || data.status === 'queued' || data.status === 'uploading' || data.status === 'started' || data.status === 'not-started') {
            const output = {
                progress: data.progress,
                status: data.status,
            };

            if (data.outputs && data.outputs.length > 0 && data.outputs[0].data) {
                const stuffData = data.outputs[0].data;
                if (stuffData.images && stuffData.images.length > 0) {
                    output.imageUrl = stuffData.images[0].url;
                    console.log('Image URL:', output.imageUrl);
                }
            }

            return output;
        } else {
            console.error('Invalid workflow status:', data.status);
            return null;
        }
    } else {
        console.error('Failed to fetch workflow status:', response.statusText);
        return null;
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
    generateImage,
    fetchWorkflowOutput
}