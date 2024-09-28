const { handleLoraTrigger } = require('../utils/models/loraTriggerTranslate.js')
const defaultSettings = require('../utils/models/defaultSettings.js')
const {getBasePromptByName } = require('../utils/models/basepromptmenu.js')
const { getDeploymentIdByType }= require('../utils/comfydeploy/deployment_ids.js');
// Function to handle sending the generated image

const webHook = 'http://'+process.env.ME+'/api/webhook'//"https://446a-2601-483-802-6d20-c06d-1229-e139-d3cc.ngrok-free.app/api/webhook"
const baseNegPrompt = 'embedding:easynegative'
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

// Function to make the API request and handle the response
async function generate(promptObj) {
    if(promptObj.prompt == '' && promptObj.type != 'MS3'){
        return;
    }
    try {
        //console.log('well what is the prompt object here',promptObj)
        imgPreProc(promptObj);
        promptPreProc(promptObj);
        const body = prepareRequest(promptObj);
        //console.log(body);
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
            //console.log('runid',run_id);
            return run_id;
        } else {
                   // If the response is not ok, log the status and error message
            const errorText = await response.text();  // Use response.text() to capture error details
            console.error('Failed to fetch:', errorText);
            return -1;
        }

    } catch (error) {
        console.error("Error generating image:", error);
    }
}

function imgPreProc(promptObj) {
    //console.log('processing image');
    if(promptObj.type.slice(0,4) == 'MAKE'){
        //console.log('make type')
        return
    }
    //console.log(promptObj);
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
    // if(promptObj.fileUrl[0] == "i"){
    //     promptObj.fileUrl = promptObj.fileUrl.slice(7)
    //     metaIPFS= `https://mony.mypinata.cloud/ipfs/${promptObj.fileUrl}`,
    //     urlAppend= process.env.PINATA_APPEND
    //     promptObj.fileUrl  = `${metaIPFS}/${urlAppend}`
    // }
}

function promptPreProc(promptObj) {
    const censoredWords = ["topless", "lingerie", "stripper", "boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen", "rape"];
    let promptFinal = handleLoraTrigger(`${promptObj.prompt} ${promptObj.userBasePrompt == '-1' ?  '' : ', ' + promptObj.userBasePrompt + ', '} ${getBasePromptByName(promptObj.basePrompt)}`,promptObj.checkpoint, promptObj.balance);
    let justPromptFinal = handleLoraTrigger(`${promptObj.prompt} ${promptObj.userBasePrompt == '-1' ?  '' : ', ' + promptObj.userBasePrompt + ', '}`, promptObj.checkpoint, promptObj.balance)
    // Filter out censored words if applicable
    if (promptObj.balance < 1000000) {
        promptFinal = promptFinal.split(" ")
                                    // .map(word => word.replace(/[^\w\s]|_/g, ''))
                                    .filter(word => !censoredWords.includes(word))
                                    .join(" ");
    }
    // Handle LoRa triggers or any other final modifications
    //promptObj.prompt = handleLoraTrigger(cleanedPrompt+" ", promptObj.balance);
    promptObj.finalPrompt = promptFinal;
    promptObj.justPrompt = justPromptFinal;
}

function chooseIdByMachine(ids,promptObj) {
    if(ids.length > 1){
        if(!promptObj.machine){
            return ids[1]
        }
        return ids[promptObj.machine]
    } else {
        return ids[0]
    }
}

function prepareRequest(promptObj) {
    //let basePrompt = handleLoraTrigger(getBasePromptByName(promptObj.basePrompt),promptObj.balance);
    const comfydeployids = getDeploymentIdByType(promptObj.type);
    const comfydeployid = chooseIdByMachine(comfydeployids, promptObj);
    //console.log('prepareRequest', comfydeployid)
    // Base structure that works for most complex cases like PFP_CONTROL_STYLE
    let body = {
        deployment_id: comfydeployid,
        webhook: webHook,
        inputs: {
            input_seed: promptObj.seed,
            input_batch: promptObj.batchMax,
            input_steps: promptObj.steps,
            input_cfg: promptObj.cfg,
            input_prompt: promptObj.finalPrompt,
            input_checkpoint: `${promptObj.checkpoint}.safetensors`,
            input_image: promptObj.fileUrl || null,
            input_strength: promptObj.strength || null,
            input_style_image: promptObj.styleFileUrl || null,
            input_canny_image: promptObj.controlFileUrl || null,
            input_pose_image: promptObj.poseFileUrl || null,
            input_width: promptObj.photoStats?.width || null,
            input_height: promptObj.photoStats?.height || null,
            input_negative: promptObj.negativePrompt == '-1' ? '' : `${promptObj.negativePrompt} ${baseNegPrompt}`,
        }
    };

        // Remove any null or undefined fields from the `inputs`
        body.inputs = Object.fromEntries(
            Object.entries(body.inputs).filter(([_, value]) => value !== null && value !== undefined)
        );

    // Handle special cases where fewer fields are needed
    switch (promptObj.type) {
        case 'MOG':
            console.log('oh we mogging alright')
            console.log(comfydeployid)
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `j0yc4t ${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'DEGOD':
            console.log('oh we degod alright')
            console.log(comfydeployid)
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `man wearing d3g0d mask ${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'MILADY':
            console.log('oh milady alright')
            console.log(comfydeployid)
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `milady ${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'CHUD':
            console.log('oh chud alright')
            console.log(comfydeployid)
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `chudjak ${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'RADBRO':
            console.log('oh radbro alright')
            console.log(comfydeployid)
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `radbro ${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'FLUX': 
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    noise_seed: promptObj.seed,
                    cfg: promptObj.cfg,
                    input_height: promptObj.photoStats.height,
                    input_width: promptObj.photoStats.width,
                    input_text: `${promptObj.justPrompt}`,
                }
            }
            //console.log('body for mog',body)
            break;
        case 'RMBG':
        case 'UPSCALE':
        case 'INTERROGATE':
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    input_image: promptObj.fileUrl
                }
            };
            break;
        case 'INPAINT':
            body = {
                deployment_id: comfydeployid,
                webhook: webHook,
                inputs: {
                    input_image_url: promptObj.fileUrl,
                    positive_prompt: `${promptObj.finalPrompt}`,
                    negative_prompt: promptObj.negativePrompt,
                    inpainting_area: promptObj.inpaintTarget,
                    noise: promptObj.strength
                }
            };
            break;
    }

    return JSON.stringify(body);
}

module.exports = {
    //sendGeneratedImage,
    generate,
    fetchOutput
}