
//const fs = require('fs');
//const { addWaterMark } = require('./waterMark.js');
const { handleLoraTrigger } = require('../utils/models/loraTriggerTranslate.js')
const defaultSettings = require('../utils/models/defaultSettings.js')
//const fetch = require('fetch');

const {defaultPrompt, basepromptmenu, getBasePromptByName } = require('../utils/models/basepromptmenu.js')
const { getDeploymentIdByType }= require('../utils/comfydeploy/deployment_ids.js');
// Function to handle sending the generated image

const webHook = 'http://'+process.env.ME+'/api/webhook'//"https://446a-2601-483-802-6d20-c06d-1229-e139-d3cc.ngrok-free.app/api/webhook"

// Function to extract type from the URL or outputItem.type field
function extractType(url) {
    // Example logic to extract type from the URL or outputItem.type field
    const extension = url.split('.').pop().toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg' || extension === 'png') {
        return 'image';
    } else if (extension === 'gif') {
        return 'gif';
    } else if (extension === 'mp4' || extension === 'avi' || extension === 'mov') {
        return 'video';
    } else {
        // Default to 'unknown' type if extension is not recognized
        return 'unknown';
    }
}
async function fetchOutput(run_id) {
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
                imgUrls: []
            };
            console.log(JSON.stringify(data));
            const possibleTypes = ["images", "gifs", "videos"];

            if (data.outputs && data.outputs.length > 0) {
                console.log("Outputs found:", data.outputs.length);
                data.outputs.forEach(outputItem => {
                    possibleTypes.forEach(type => {
                        if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
                            outputItem.data[type].forEach(dataItem => {
                                const url = dataItem.url;
                                // Extract type from the filename or from the URL
                                const fileType = extractType(url);
                                output.imgUrls.push({ type: fileType, url });
                                console.log(`${fileType.toUpperCase()} URL:`, url);
                            });
                        }
                    });
                });
            } else {
                console.log("No outputs found.");
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


// Function to handle sending the generated image

// Function to make the API request and handle the response
async function generate(promptObj) {
    if(promptObj.prompt == ''){
        return;
    }
    try {
        //console.log('well what is the prompt object here',promptObj)
        imgPreProc(promptObj);
        promptPreProc(promptObj);
        const body = prepareRequest(promptObj);
        console.log(body);
        let run_id;
        const response = await fetch("https://www.comfydeploy.com/api/run", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
            },
            body: body,
        });

        if (response.ok) {
            const data = await response.json();
            ( run_id ) = data.run_id;
            console.log('runid',run_id);
            return run_id;
        } else {
            console.error('Failed to fetch:', response.body.stream);
            return -1
        }

    } catch (error) {
        console.error("Error generating image:", error);
    }
}


function imgPreProc(promptObj) {
    if(promptObj.type == 'MAKE'){
        console.log('make type')
        return
    }
    console.log(promptObj);
    let height = promptObj.photoStats.height;
    let width = promptObj.photoStats.width;
    const ratio = height / width;
    if(height > width){
        promptObj.photoStats.width = Math.floor((defaultSettings.WIDTH / ratio) / 8) * 8;
        promptObj.photoStats.height = defaultSettings.HEIGHT;
    } else if (width > height) {
        promptObj.photoStats.height = Math.floor((defaultSettings.HEIGHT * ratio) / 8) * 8;
        promptObj.photoStats.width = defaultSettings.WIDTH;
    }
    if(promptObj.fileUrl[0] == "i"){
        promptObj.fileUrl = promptObj.fileUrl.slice(7)
        metaIPFS= `https://mony.mypinata.cloud/ipfs/${promptObj.fileUrl}`,
        urlAppend= process.env.PINATA_APPEND
        promptObj.fileUrl  = `${metaIPFS}/${urlAppend}`
    }
}

function promptPreProc(promptObj) {
    const censoredWords = ["topless", "lingerie", "stripper", "boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen", "rape"];
    
    // Initial cleanup
    let cleanedPrompt = promptObj.prompt.replace(`@${process.env.BOT_NAME}`, "").trim();

    // Specific handling based on the type of prompt
    switch (promptObj.type){
        case "MAKE":
            cleanedPrompt = cleanedPrompt.replace("/make", "");
        break;
        case "MS2":
            cleanedPrompt = cleanedPrompt.replace("/ms2", "");
        break;
    }

    // Filter out censored words if applicable
    if (promptObj.balance < 1000000) {
        cleanedPrompt = cleanedPrompt.split(" ")
                                    .map(word => word.replace(/[^\w\s]|_/g, ''))
                                    .filter(word => !censoredWords.includes(word))
                                    .join(" ");
    }
    // Handle LoRa triggers or any other final modifications
    promptObj.prompt = handleLoraTrigger(cleanedPrompt);
}

function prepareRequest(promptObj) {
    let basePrompt = getBasePromptByName(promptObj.basePrompt);
    let userBasePrompt;
    let negPrompt;
    promptObj.userBasePrompt == '-1' ?  userBasePrompt = '' : userBasePrompt = promptObj.userBasePrompt
    promptObj.negativePrompt == '-1' ?  negPrompt = '' : negPrompt = promptObj.negativePrompt;
    const comfydeployid = getDeploymentIdByType(promptObj.type);
    console.log(comfydeployid);
    console.log(promptObj.prompt +" "+ userBasePrompt + basePrompt)
    switch(promptObj.type) {
        case "MAKE":
            body = JSON.stringify({
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    input_width: promptObj.photoStats.width,
                    input_height: promptObj.photoStats.height,
                    input_seed: promptObj.seed,
                    input_batch: promptObj.batchMax,
                    input_steps: promptObj.steps,
                    input_cfg: promptObj.cfg,
                    input_prompt: promptObj.prompt +" "+ userBasePrompt + basePrompt,
                    input_checkpoint: promptObj.checkpoint
                }
            });
            
            break;
        case "MS2":
            body = JSON.stringify({
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                  "input_seed": promptObj.seed,
                  "input_batch": promptObj.batchMax,
                  "input_steps": promptObj.steps,
                  "input_cfg": promptObj.cfg,
                  "input_prompt": promptObj.prompt +" "+ userBasePrompt + basePrompt,
                  "input_checkpoint": promptObj.checkpoint,
                  "input_image": promptObj.fileUrl,
                  "input_strength": promptObj.strength
                }
              })
            break;
        case "MS3":
            body = JSON.stringify({
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    "input_image": promptObj.fileUrl
                  }
              })
            break;
    };
    
    return body;
}

// async function processImages(images, promptObj, start) {
//     let filenames = images.map((img, index) => {
//         const filename = `./tmp/${promptObj.wallet}_${Date.now()}${index}.png`;
//         fs.writeFileSync(filename, Buffer.from(img, "base64"), 'base64');
//         return filename;
//     });

//     // Optionally apply watermark if required
//     if (promptObj.waterMark) {
//         await Promise.all(filenames.map(addWaterMark));
//     }

//     // Calculate processing time
//     const end = process.hrtime(start);
//     const time = end[0] - start[0];  // assuming start is also hrtime format
//     console.log(end[0],start[0])
//     return { time, filenames };
// }

// module.exports = {
//     generateImage
// }
module.exports = {
    //sendGeneratedImage,
    generate,
    fetchOutput
}