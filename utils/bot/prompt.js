
function buildPromptObjFromWorkflow(workflow, userContext, message) {
    const promptObj = {
        userId: userContext.userId,
        type: userContext.type,
        balance: userContext.balance,
        userPrompt: userContext.userPrompt,
        basePrompt: userContext.basePrompt,
        timeRequested: Date.now(),
        prompt: userContext.prompt,
        forceLogo: userContext.forceLogo,
        input_batch: userContext.input_batch,
        input_text: message.from.username || 'idk',
        input_seed: userContext.input_seed,
        input_negative: userContext.input_negative || 'embedding:easynegative'
    };
    if(!workflow){
        console.log('!!! build promptObj fail from ',userContext.type)
    }
    workflow?.inputs.forEach((input) => {
        if (userContext.hasOwnProperty(input)) {
            promptObj[input] = userContext[input];
        }
    });
    if(promptObj.input_checkpoint) promptObj.input_checkpoint += '.safetensors'
    const fluxTypes = ['MAKE','MAKE_PLUS','I2I','LOSER','MILADY','MOG','CHUDJAK','INPAINT']
    if (fluxTypes.includes(userContext.type)) {
        promptObj.input_checkpoint = 'flux-schnell'
        delete promptObj.basePrompt;
        // delete promptObj. delete negative
    }
    // Derive fields based on existing flags
    // ControlNet
    if (userContext.controlNet) {
        promptObj.input_apply_canny_strength = 1;
        promptObj.input_apply_canny_start_percent = 0;
        promptObj.input_apply_canny_end_percent = 1;
        promptObj.input_control_image = userContext.input_control_image || null; // Optional control image
    } else {
        promptObj.input_apply_canny_strength = 0;
        promptObj.input_apply_canny_start_percent = 0;
        promptObj.input_apply_canny_end_percent = 0;
    }

    // Style Transfer
    if (userContext.styleTransfer) {
        promptObj.input_ipadapter_weight = 1;
        promptObj.input_ipadapter_start = 0;
        promptObj.input_ipadapter_end = 1;
        promptObj.input_style_image = userContext.input_style_image || null; // Optional style image
    } else {
        promptObj.input_ipadapter_weight = 0;
        promptObj.input_ipadapter_start = 0;
        promptObj.input_ipadapter_end = 0;
    }

    // OpenPose
    if (userContext.openPose) {
        promptObj.input_pose_strength = 1;
        promptObj.input_pose_start = 0;
        promptObj.input_pose_end = 1;
        promptObj.input_pose_image = userContext.input_pose_image || null; // Optional pose image
    } else {
        promptObj.input_pose_strength = 0;
        promptObj.input_pose_start = 0;
        promptObj.input_pose_end = 0;
    }

    // Cleanup unused fields for clarity
    if (!userContext.controlNet) delete promptObj.input_control_image;
    if (!userContext.styleTransfer) delete promptObj.input_style_image;
    if (!userContext.openPose) delete promptObj.input_pose_image;
    // if (!userContext.type != 'MAKE','FLUX') 
    const text2images = ['QUICKMAKE','MAKE','MAKE_PLUS','MILADY','DEGOD','LOSER']
    if (
        text2images.some(type => userContext.type.startsWith(type)) &&
        userContext.type !== 'I2I'
    ) {
        delete promptObj.input_image;
        promptObj.input_strength = 1;
    }

    // Include message details for tracking and additional context
    promptObj.username = message.from?.username;
    return promptObj;
}

module.exports = {
    buildPromptObjFromWorkflow
};