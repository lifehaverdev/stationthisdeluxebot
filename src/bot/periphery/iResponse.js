const { STATES, lobby, stateHandlers } = require('../core/core')
const { sendMessage, editMessage, setUserState } = require('../utils')
//const { stateHandlers } = require('./iMessage')

class StarterFunction {
    constructor(state, customMessage, balanceThreshold = null, preconditions = null) {
        this.state = state;
        this.customMessage = customMessage;
        this.balanceThreshold = balanceThreshold;
        this.preconditions = preconditions;
    }

    applyPreconditions(user) {
        if (this.preconditions) {
            if (this.preconditions.styleTransfer !== undefined) {
                lobby[user].styleTransfer = this.preconditions.styleTransfer;
            }
            if (this.preconditions.controlNet !== undefined) {
                lobby[user].controlNet = this.preconditions.controlNet;
            }
            if (this.preconditions.openPose !== undefined) {
                lobby[user].openPose = this.preconditions.openPose;
            }
        }
    }

    async start(message, user = null) {
        console.log('we are in a start')
        // Apply preconditions if user is provided
        if (user) {
            this.applyPreconditions(user);
        }

        const userId = user ? user : message.from.id;

        // Check balance if threshold is set and user is not passed in
        if (this.balanceThreshold !== null && !user && lobby[userId] && lobby[userId].balance < this.balanceThreshold) {
            return this.gated(message);
        }

        // If reply_to_message contains a photo or document, proceed to handle it directly
        if (message.reply_to_message) {
            console.log('reply found',message.reply_to_message)
            if (message.reply_to_message.photo || message.reply_to_message.document) {
                console.log('Image or document found in reply_to_message, forwarding to state handler directly.');
                // Forward the reply_to_message to the appropriate state handler
                return this.forwardToStateHandler(message.reply_to_message, userId);
            }
        }

        // If no image found, prompt the user
        if (user) {
            message.from.id = user;
            await this.editMessage(message);
        } else {
            this.sendMessage(message);
        }

        // Set the user's state
        this.setUserState(message);
    }

    async forwardToStateHandler(replyMessage, userId) {
        // Ensure that the message is attributed to the original user
        replyMessage.from = { id: userId };

        // Use the state handler to process the image or document
        if (stateHandlers[this.state]) {
            await stateHandlers[this.state](replyMessage);
        } else {
            console.error(`No handler found for state: ${this.state}`);
        }
    }

    async editMessage(message) {
        await editMessage({
            text: this.customMessage,
            chat_id: message.chat.id,
            message_id: message.message_id
        });
    }

    sendMessage(message) {
        sendMessage(message, this.customMessage, {
            reply_to_message_id: message.message_id
        });
    }

    setUserState(message) {
        setUserState(message, this.state);
    }

    gated(message) {
        gated(message);
    }
}


class CallAndResponse {
    constructor(initialState, steps) {
        this.initialState = initialState;
        this.steps = steps; // Array of steps, each with a type ('image', 'prompt'), a message, and a processing function
    }

    async start(message, user) {
        setUserState(message, this.initialState);
        await this.processStep(message, user, 0);
    }

    async processStep(message, user, stepIndex) {
        if (stepIndex >= this.steps.length) {
            return;
        }

        const step = this.steps[stepIndex];
        let processed = false;

        // Check token gate and other conditions before processing the step
        if (this.tokenGate(message)) {
            return;
        }

        switch (step.type) {
            case 'image':
                processed = await this.handleImage(message, step.processFunction);
                break;
            case 'prompt':
                processed = await this.handlePrompt(message, step.processFunction);
                break;
        }

        if (processed) {
            if (stepIndex + 1 < this.steps.length) {
                if (this.controlNetStyleTransferCheck(message)) {
                    await sendMessage(message, this.steps[stepIndex + 1].message);
                    setUserState(message, this.steps[stepIndex + 1].state);
                }
            } else {
                setUserState(message, STATES.IDLE);
            }
        } else {
            await sendMessage(message, "There was an issue processing your input. Please try again.");
        }
    }

    async handleImage(message, processFunction) {
        if (!message.photo && !message.document) {
            await sendMessage(message, "Please send a valid image.");
            return false;
        }

        const fileUrl = await getPhotoUrl(message);
        return processFunction(message, fileUrl);
    }

    async handlePrompt(message, processFunction) {
        return processFunction(message, message.text);
    }

    tokenGate(message) {
        const userId = message.from.id;
        if (lobby[userId] && lobby[userId].balance <= 400000) {
            gated(message);
            return true;
        }
        return false;
    }

    controlNetStyleTransferCheck(message) {
        const userId = message.from.id;
        const userLobby = lobby[userId];

        if (userLobby.styleTransfer && !userLobby.controlNet) {
            if (!userLobby.input_style_image) {
                sendMessage(message, 'pls first send a style image');
                setUserState(message, STATES.SETSTYLE)
                return false;
            }
            userLobby.type = 'MS2_STYLE';
        } else if (userLobby.styleTransfer && userLobby.controlNet) {
            if (!userLobby.input_style_image && !userLobby.input_control_image) {
                setUserState(message, STATES.SETSTYLE)
                sendMessage(message, 'pls first send a style iamge');
                return false;
            }
            userLobby.type = 'MS2_CONTROL_STYLE';
        } else if (userLobby.controlNet && !userLobby.styleTransfer) {
            userLobby.type = 'MS2_CONTROL';
        }

        return true;
    }
}



// Example usage for each starter function:
const ms2Starter = new StarterFunction(STATES.IMG2IMG, 'Send in the photo you want to img to img.',null,null);
const fluxi2iStarter = new StarterFunction(STATES.FLUX2IMG, 'Send in the photo you want to flux img to img.',null,null);

const makeStarter = new StarterFunction(STATES.MAKE, 'What prompt for your txt2img?',null,null);
const fluxStarter = new StarterFunction(STATES.FLUX, 'What prompt for your flux txt2img?',null,null);

const pfpStarter = new StarterFunction(STATES.PFP, 'Send in the photo you want to img to img. I will do the prompt myself.', 300000, null);

const ms3Starter = new StarterFunction(STATES.MS3, 'Send in the photo you want to img to video.', 600000);
const ms3V2Starter = new StarterFunction(STATES.MS3V2, 'Send in the photo you want to img to video. (v2)', 600000);
const rmbgStarter = new StarterFunction(STATES.RMBG, 'Send me the photo to remove the background from', 200000);
const upscaleStarter = new StarterFunction(STATES.UPSCALE, 'Send me the photo you want to upscale', 200000);
//const makeStarter = new StarterFunction(STATES.MAKE, 'What prompt for your txt2img?');
const make3Starter = new StarterFunction(STATES.MAKE3, 'What prompt for your txt2img sd3', 500000);
const discStarter = new StarterFunction(STATES.DISC, 'Send in the photo you want to write to a disc.', 200000);
//const watermarkStarter = new StarterFunction(STATES.WATERMARK, 'Send in the photo you want to watermark.', 200000);

const interrogateStarter = new StarterFunction(STATES.INTERROGATION, 'Send in the photo you want to extract a prompt from');
const assistStarter = new StarterFunction(STATES.ASSIST, 'What prompt do you need help with');
const flassistStarter = new StarterFunction(STATES.FLASSIST, 'What prompt do you need help with');
//const speakStarter = new StarterFunction(STATES.SPEAK, 'What should I say?');

const inpaintStarter = new StarterFunction(STATES.INPAINT, 'Send in the photo you want to inpaint', 300000, null)

const wifeyWlStarter = new StarterFunction(STATES.WL, 'Send in your solana address',null,null);

const ms2Flow = new CallAndResponse(STATES.MS2, [
    {
        type: 'image',
        message: 'okay lemme see...',
        state: STATES.MS2PROMPT,
        processFunction: async (message, fileUrl) => {
            const userId = message.from.id;
            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                lobby[userId] = {
                    ...lobby[userId],
                    lastSeed: makeSeed(userId),
                    tempSize: { width, height },
                    input_image: fileUrl
                };

                await sendMessage(message, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);
                return true;
            } catch (error) {
                console.error("Error processing photo:", error);
                await sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");
                return false;
            }
        }
    },
    {
        type: 'prompt',
        message: '',
        state: STATES.IDLE,
        processFunction: async (message, userInput) => {
            const userId = message.from.id;

            lobby[userId] = {
                ...lobby[userId],
                prompt: userInput || '',
                type: 'MS2'
            };

            return true;
        }
    }
]);

const inpaintFlow = new CallAndResponse(STATES.INPAINT, [
    {
        type: 'image',
        message: 'Send in the photo you want to inpaint.',
        state: STATES.INPAINTTARGET,
        processFunction: async (message, fileUrl) => {
            const userId = message.from.id;
            try {
                const photo = await Jimp.read(fileUrl);
                const { width, height } = photo.bitmap;

                lobby[userId] = {
                    ...lobby[userId],
                    lastSeed: makeSeed(userId),
                    tempSize: { width, height },
                    input_image: fileUrl
                };

                await sendMessage(message, `The dimensions of the photo are ${width}x${height}. Describe what part of the photo you want to replace.`);
                return true;
            } catch (error) {
                console.error("Error processing photo:", error);
                await sendMessage(message, "An error occurred while processing the photo. Please send it again, or another photo.");
                return false;
            }
        }
    },
    {
        type: 'prompt',
        message: 'What do you want instead of what you described?',
        state: STATES.INPAINTPROMPT,
        processFunction: async (message, userInput) => {
            const userId = message.from.id;

            lobby[userId] = {
                ...lobby[userId],
                inpaintTarget: userInput || '',
                type: 'INPAINT'
            };

            return true;
        }
    },
    {
        type: 'prompt',
        message: '',
        state: STATES.IDLE,
        processFunction: async (message, userInput) => {
            const userId = message.from.id;

            lobby[userId] = {
                ...lobby[userId],
                prompt: userInput || ''
            };

            enqueueTask({ message, promptObj: { ...lobby[userId], input_seed: lobby[userId].lastSeed, input_width: lobby[userId].tempSize.width, input_height: lobby[userId].tempSize.height } });
            return true;
        }
    }
]);



module.exports = {
    ms2Starter,
    pfpStarter,
    // pfpStyleStarter,
    // pfpControlStarter,
    // pfpControlStyleStarter,
    ms3Starter,
    ms3V2Starter,
    rmbgStarter,
    upscaleStarter,
    makeStarter,
    make3Starter,
    discStarter,
    //watermarkStarter,
    // makeStyleStarter,
    // makeControlStarter,
    // makeControlStyleStarter,
    // ms2ControlStarter,
    // ms2StyleStarter,
    // ms2ControlStyleStarter,
    interrogateStarter,
    assistStarter,
    flassistStarter,
    //speakStarter,
    inpaintStarter,
    wifeyWlStarter,

    ms2Flow,
    inpaintFlow,

    fluxStarter,
    fluxi2iStarter,

    // ms2PoseStarter, ms2StylePoseStarter, ms2ControlPoseStarter, ms2ControlStylePoseStarter,
    // makePoseStarter, makeStylePoseStarter, makeControlPoseStarter, makeControlStylePoseStarter,
    // pfpPoseStarter, pfpStylePoseStarter, pfpControlPoseStarter, pfpControlStylePoseStarter

}