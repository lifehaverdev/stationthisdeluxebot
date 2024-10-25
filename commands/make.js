const { handleLoraTrigger } = require('../utils/models/loraTriggerTranslate.js')
const defaultSettings = require('../utils/models/defaultSettings.js')
const {getBasePromptByName } = require('../utils/models/basepromptmenu.js')
const { getDeploymentIdByType }= require('../utils/comfydeploy/deployment_ids.js');
// Function to handle sending the generated image

const webHook = 'http://'+process.env.ME+'/api/webhook'//"https://446a-2601-483-802-6d20-c06d-1229-e139-d3cc.ngrok-free.app/api/webhook"
const baseNegPrompt = 'embedding:easynegative'

// Common prompt object fields
function buildCommonPromptObj(userContext, message) {
    return {
        type: userContext.type || 'default_type',
        username: message.from.username || 'unknown_user',
        balance: userContext.balance,
        userId: userContext.userId,
        photoStats: { height: 1024, width: 1024 },
        timeRequested: Date.now(),
        userBasePrompt: userContext.userBasePrompt
    };
}

// Helper function to build the prompt object dynamically based on the workflow
function buildPromptObjFromWorkflow(workflow, userContext, message, typeMappings) {
    const promptObj = buildCommonPromptObj(userContext, message);
    
    // Extract the base type and any appendages
    const workflowParts = workflow.name.split('_');  // e.g., ['MAKE', 'STYLE', 'POSE']
    const baseType = workflowParts[0];  // First part is the base, e.g., 'MAKE'

    // Apply base type mappings (e.g., MAKE)
    const baseMapping = typeMappings[baseType];
    if (baseMapping) {
        Object.keys(baseMapping).forEach(key => {
            applyMapping(promptObj, userContext, key, baseMapping[key]);
        });
    }

    // Apply appendage type mappings (e.g., STYLE, POSE)
    workflowParts.slice(1).forEach(appendageType => {
        const appendageMapping = typeMappings[appendageType];
        if (appendageMapping) {
            Object.keys(appendageMapping).forEach(key => {
                applyMapping(promptObj, userContext, key, appendageMapping[key]);
            });
        }
    });

    return promptObj;
}

// Helper function to apply mappings, handling nested objects
function applyMapping(promptObj, userContext, key, value) {
    if (typeof value === 'object') {
        // Handle nested mappings (e.g., photoStats)
        Object.keys(value).forEach(subKey => {
            promptObj[key][subKey] = userContext[value[subKey]] || promptObj[key][subKey];
        });
    } else if (userContext[key] !== undefined) {
        // Map directly if it's a simple field
        promptObj[key] = userContext[value] || promptObj[key];
    } else {
        // Default values for missing userContext fields
        promptObj[key] = typeof value === 'number' ? value : 'default_value';
    }
}


// Common prompt object fields
function buildCommonPromptObj(userContext, message) {
    return {
        type: userContext.type || 'default_type',
        username: message.from.username || 'unknown_user',
        balance: userContext.balance,
        userId: userContext.userId,
        photoStats: { height: 1024, width: 1024 },
        timeRequested: Date.now(),
        userBasePrompt: userContext.userBasePrompt
    };
}




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
            //console.log(JSON.stringify(data));
            const possibleTypes = ["images", "gifs", "videos"];

            if (data.outputs && data.outputs.length > 0) {
                //console.log("Outputs found:", data.outputs.length);
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

function promptPreProc(promptObj) {
    const censoredWords = ["topless", "lingerie", "stripper", "boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen", "rape"];
    
    const promptArrangement = promptObj.type == 'FLUX' ? 
    `${promptObj.prompt} ${promptObj.userBasePrompt == '-1' ?  '' : ', ' + promptObj.userBasePrompt + ', '}` :
    `${promptObj.prompt} ${promptObj.userBasePrompt == '-1' ?  '' : ', ' + promptObj.userBasePrompt + ', '} ${getBasePromptByName(promptObj.basePrompt)}`
    let promptFinal = handleLoraTrigger(promptArrangement, promptObj.checkpoint, promptObj.balance)
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
    //promptObj.justPrompt = justPromptFinal;
}
// Function to make the API request and handle the response
async function generate(promptObj) {
    if(promptObj.prompt == '' && (promptObj.type != 'MS3' && promptObj.type != 'MS3.2')){
        console.log(promptObj.type )
        console.log('generate return by type none or vid')
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
            body: JSON.stringify(body),
        });
        //console.log(response)

        if (response.ok) {
            const data = await response.json();
            ( run_id ) = data.run_id;
            console.log('runid',run_id);
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
    if(promptObj.type.slice(0,3) != 'I2I' ||
        promptObj.type.slice(0,3) != 'PFP' ||
        promptObj.type.slice(0,3) != 'MS3'
    ){
        //console.log('make type')
        return
    }
    //console.log(promptObj);
    let height = promptObj.input_height;
    let width = promptObj.input_weight;
    const ratio = height / width;
    if(height > width){
        promptObj.input_width = Math.floor((defaultSettings.WIDTH / ratio) / 8) * 8;
        promptObj.input_height = defaultSettings.HEIGHT;
    } else if (width > height) {
        promptObj.input_height = Math.floor((defaultSettings.HEIGHT * ratio) / 8) * 8;
        promptObj.input_width = defaultSettings.WIDTH;
    }
    // if(promptObj.fileUrl[0] == "i"){
    //     promptObj.fileUrl = promptObj.fileUrl.slice(7)
    //     metaIPFS= `https://mony.mypinata.cloud/ipfs/${promptObj.fileUrl}`,
    //     urlAppend= process.env.PINATA_APPEND
    //     promptObj.fileUrl  = `${metaIPFS}/${urlAppend}`
    // }
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
    const {ids, inputs} = getDeploymentIdByType(promptObj.type);
    console.log(ids)
    const comfydeployid = chooseIdByMachine(ids, promptObj);
    // Prepare the request body dynamically based on workflow inputs
    
    const body = {
        deployment_id: comfydeployid,
        webhook: webHook,
        inputs: {}
    };

    inputs.forEach(inputKey => {
        if (promptObj.hasOwnProperty(inputKey)) {
            body.inputs[inputKey] = promptObj[inputKey];
        }
    });

    // Add additional metadata or necessary fields for the request
    body.inputs.input_negative = promptObj.input_negative == '-1' 
        ? ''
        : `${promptObj.input_negative}`;

    body.inputs.input_prompt = promptObj.finalPrompt

    return body;
}

// function prepareRequest(promptObj) {
//     //let basePrompt = handleLoraTrigger(getBasePromptByName(promptObj.basePrompt),promptObj.balance);
//     const comfydeployids = getDeploymentIdByType(promptObj.type);
//     const comfydeployid = chooseIdByMachine(comfydeployids, promptObj);
//     //console.log('prepareRequest', comfydeployid)
//     // Base structure that works for most complex cases like PFP_CONTROL_STYLE
//     let body = {
//         deployment_id: comfydeployid,
//         webhook: webHook,
//         inputs: {
//             input_seed: promptObj.seed,
//             input_batch: promptObj.batchMax,
//             input_steps: promptObj.steps,
//             input_cfg: promptObj.cfg,
//             input_prompt: promptObj.finalPrompt,
//             input_checkpoint: `${promptObj.checkpoint}.safetensors`,
//             input_image: promptObj.fileUrl || null,
//             input_strength: promptObj.strength || null,
//             input_style_image: promptObj.styleFileUrl || null,
//             input_canny_image: promptObj.controlFileUrl || null,
//             input_pose_image: promptObj.poseFileUrl || null,
//             input_width: promptObj.photoStats?.width || null,
//             input_height: promptObj.photoStats?.height || null,
//             input_negative: promptObj.negativePrompt == '-1' ? baseNegPrompt : `${promptObj.negativePrompt} ${baseNegPrompt}`,
//         }
//     };

//         // Remove any null or undefined fields from the `inputs`
//         body.inputs = Object.fromEntries(
//             Object.entries(body.inputs).filter(([_, value]) => value !== null && value !== undefined)
//         );

//     // Handle special cases where fewer fields are needed
//     switch (promptObj.type) {
//         case 'MOG':
//             console.log('oh we mogging alright')
//             console.log(comfydeployid)
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `j0yc4t ${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'DEGOD':
//             console.log('oh we degod alright')
//             console.log(comfydeployid)
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `man wearing d3g0d mask ${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'MILADY':
//             console.log('oh milady alright')
//             console.log(comfydeployid)
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `milady ${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'CHUD':
//             console.log('oh chud alright')
//             console.log(comfydeployid)
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `chudjak ${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'RADBRO':
//             console.log('oh radbro alright')
//             console.log(comfydeployid)
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `radbro ${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'LOSER':
//         console.log('oh loser alright')
//         console.log(comfydeployid)
//         body = {
//             deployment_id: comfydeployid,
//             webhook: webHook,
//             inputs: {
//                 noise_seed: promptObj.seed,
//                 cfg: promptObj.cfg,
//                 input_height: promptObj.photoStats.height,
//                 input_width: promptObj.photoStats.width,
//                 input_text: `${promptObj.finalPrompt}`,
//             }
//         }
//         //console.log('body for mog',body)
//             break;
//         case 'FLUX': 
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     noise_seed: promptObj.seed,
//                     cfg: promptObj.cfg,
//                     input_height: promptObj.photoStats.height,
//                     input_width: promptObj.photoStats.width,
//                     input_text: `${promptObj.finalPrompt}`,
//                 }
//             }
//             //console.log('body for mog',body)
//             break;
//         case 'MS3.2':
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     input_image: promptObj.fileUrl || null,
//                     input_seed: promptObj.seed,
//                 }
//             }
//             break;
//         case 'RMBG':
//         case 'UPSCALE':
//         case 'INTERROGATE':
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     input_image: promptObj.fileUrl
//                 }
//             };
//             break;
//         case 'INPAINT':
//             body = {
//                 deployment_id: comfydeployid,
//                 webhook: webHook,
//                 inputs: {
//                     input_image_url: promptObj.fileUrl,
//                     positive_prompt: `${promptObj.finalPrompt}`,
//                     negative_prompt: promptObj.negativePrompt,
//                     inpainting_area: promptObj.inpaintTarget,
//                     noise: promptObj.strength
//                 }
//             };
//             break;
//     }

//     return JSON.stringify(body);
// }

module.exports = {
    //sendGeneratedImage,
    generate,
    fetchOutput,
    buildPromptObjFromWorkflow
}