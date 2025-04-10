const { handleLoraTrigger } = require('../../utils/models/loraTriggerTranslate')
const defaultSettings = require('../../utils/models/defaultSettings')
const {getBasePromptByName } = require('../../utils/models/basepromptmenu')
const { getDeploymentIdByType }= require('../../utils/comfydeploy/deployment_ids');
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

async function promptPreProc(promptObj) {
    const censoredWords = ["topless", "lingerie", "stripper", "boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen", "rape"];
    const basepromptlessTypes = ['MAKE','I2I','MAKE_PLUS','INPAINT','MILADY','CHUD','RADBRO','LOSER','I2I_3','MAKE3','MS3.3'];

    // Log the initial state of promptObj
    //console.log('Initial prompt first 10 chars:', promptObj.prompt?.substring(0, 10));

    const promptArrangement = basepromptlessTypes.includes(promptObj.type) ? 
        `${promptObj.prompt} ${promptObj.userPrompt == '-1' ?  '' : ', ' + promptObj.userPrompt + ', '}` :
        `${promptObj.prompt} ${promptObj.userPrompt == '-1' ?  '' : ', ' + promptObj.userPrompt + ', '} ${getBasePromptByName(promptObj.basePrompt)}`;

    // Log the prompt arrangement
    //console.log('Prompt arrangement:', promptArrangement);

    try {
        // Ensure promptObj properties are defined
        if (promptObj.input_checkpoint && promptObj.balance !== undefined) {
            let promptFinal = await handleLoraTrigger(promptArrangement, promptObj.input_checkpoint, promptObj.balance);
            // Log the final prompt
            console.log('Final prompt:', promptFinal);
            promptObj.finalPrompt = promptFinal;
        } else {
            console.error('Missing properties in promptObj:', promptObj);
            promptObj.finalPrompt = promptArrangement;
        }
    } catch (error) {
        console.error('Error in handleLoraTrigger:', error);
    }
}
// Function to make the API request and handle the response
async function generate(promptObj) {
    const promptless = [
        'MS3', 'MS3.2',
        'UPSCALE', 'RMBG'
    ]
    if(promptObj.prompt == '' && (!promptless.includes(promptObj.type))){
        //console.log(promptObj.type )
        //console.log('generate return by type none or vid')
        return;
    }
    try {
        //console.log('well what is the prompt object here',promptObj)
        imgPreProc(promptObj);
        await promptPreProc(promptObj);
        const body = prepareRequest(promptObj);
        
        let run_id;
        const response = //null
            await fetch("https://www.comfydeploy.com/api/run", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
                },
                body: JSON.stringify(body),
            });
        

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
    if(promptObj.type.slice(0,3) != 'QUICKI2I' ||
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
}



function chooseIdByMachine(ids, promptObj) {
    if(ids.length > 1) {
        if(promptObj.isCookMode) {
            return ids[0]  // Use first machine for cook mode
        }
        if(promptObj.isAPI) {
            return ids[2]  // Use third machine for API mode
        }
        if(!promptObj.machine) {
            return ids[1]  // Default to second machine for regular generations
        }
        return ids[promptObj.machine]
    } else {
        return ids[0]
    }
}
function prepareRequest(promptObj) {
    const {ids, inputs} = getDeploymentIdByType(promptObj.type);
    const comfydeployid = chooseIdByMachine(ids, promptObj);
    
    const body = {
        deployment_id: comfydeployid,
        webhook: webHook,
        inputs: {}
    };

    // Define image-related input fields that need special handling
    const imageInputFields = [
        'input_control_image',
        'input_style_image',
        'input_pose_image',
        'input_image'
    ];

    inputs.forEach(inputKey => {
        if (promptObj.hasOwnProperty(inputKey)) {
            // For image fields, verify the URL is still valid or provide default
            if (imageInputFields.includes(inputKey)) {
                // If the URL is expired or missing, use empty string as fallback
                const imageUrl = promptObj[inputKey];
                body.inputs[inputKey] = imageUrl || '';
            } else {
                body.inputs[inputKey] = promptObj[inputKey];
            }
        } else if (imageInputFields.includes(inputKey)) {
            // Provide default empty string for missing image fields
            body.inputs[inputKey] = '';
        }
    });

    // Add additional metadata or necessary fields for the request
    body.inputs.input_negative = promptObj.input_negative == '-1' 
        ? ''
        : `${promptObj.input_negative}`;

    body.inputs.input_prompt = promptObj.finalPrompt

    return body;
}

module.exports = {
    //sendGeneratedImage,
    generate,
    fetchOutput,
    buildPromptObjFromWorkflow
}