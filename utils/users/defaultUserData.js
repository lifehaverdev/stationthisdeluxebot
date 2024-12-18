const defaultUserCore = {
    userId: '',
    wallet: '',
    ethWallet: '',
    verified: false,
    ethVerified: false,
    kickedAt: null,
    lastRunTime: null,
    lastTouch: null,
    createdAt: null,
};


const defaultUserEconomy = {
    balance: '',
    exp: 0,
    points: 0,
    doints: 0,
    qoints: 0,
    boints: 0,
    pendingQoints: 0,
    assets: [],
};

const defaultUserPref = {
    // Generation settings
    input_batch: 1,
    input_steps: 30,
    input_cfg: 7,
    input_strength: 0.6,
    input_height: 1024,
    input_width: 1024,
    input_image: '',
    input_control_image: '',
    input_pose_image: '',
    input_style_image: '',
    input_negative: '-1',
    input_checkpoint: "zavychromaxl_v60",
    input_seed: -1,
    lastSeed: -1,
    forceLogo: false,
    
    // User preferences
    prompt: '',
    userPrompt: '-1',
    basePrompt: "MS2",
    advancedUser: false,
    lastImage: '',
    createSwitch: 'SDXL',
    autoPrompt: false,
    voiceModel: "165UvtZp7kKnmrVrVQwx",
    waterMark: 'mslogo',
    customFileNames: false,
    
    // Feature flags
    controlNet: false,
    styleTransfer: false,
    openPose: false,
    
    // UI state
    tempSize: {
        height: 500,
        width: 500
    },
    state: {
        state: 'IDLE',
        chatId: null,
        messageThreadId: null
    },
    
    // User data
    type: '',
    inpaintTarget: '',
    runs: [],
    commandList: [
        { command: 'help', description: 'See help description' },
        { command: 'make', description: 'SDXL txt2img'},
        { command: 'flux', description: 'FLUX txt2img'},
        { command: 'effect', description: 'img2img'},
        { command: 'signin', description: 'Connect account' },
        { command: 'ca', description: 'Check chart buy' },
        { command: 'loralist', description: 'See available LoRAs' },
        { command: 'status', description: 'Check the group queue status' },
    ],
    favorites: {
        basePrompt: [],
        gens: [],
        loras: [],
    }
};

// Combined default data (for backward compatibility)
const defaultUserData = {
    ...defaultUserCore,
    ...defaultUserEconomy,
    ...defaultUserPref
};

// Data validation configuration
const numericFields = {
    // Core numeric fields
    exp: 0,
    
    // Economy numeric fields
    points: 0,
    doints: 0,
    qoints: 0,
    boints: 0,
    pendingQoints: 0,
    
    // Preference numeric fields
    input_batch: 1,
    input_steps: 30,
    input_cfg: 7,
    input_strength: 0.6,
    input_height: 1024,
    input_width: 1024,
    //-1 counted as undefined, but it is a valid seed
    //input_seed: -1,
    //lastSeed: -1,
};
// Create a separate constant for base commands
const baseCommandList = [
    { command: 'help', description: 'See help description' },
    { command: 'make', description: 'SDXL txt2img'},
    { command: 'flux', description: 'FLUX txt2img'},
    { command: 'effect', description: 'img2img'},
    { command: 'signin', description: 'Connect account' },
    { command: 'ca', description: 'Check chart buy' },
    { command: 'loralist', description: 'See available LoRAs' },
    { command: 'status', description: 'Check the group queue status' },
];
// Validation function
function validateUserData(userData) {
    const cleanedData = { ...userData };
    
    // Only validate numeric fields if they're invalid
    Object.entries(numericFields).forEach(([field, defaultValue]) => {
        const value = cleanedData[field];
        if (value === '' || 
            value === undefined || 
            value === null ||
            isNaN(Number(value))) {
            console.log(`Converting invalid value (${value}) to ${defaultValue} for field: ${field}`);
            cleanedData[field] = defaultValue;
        }
    });
    
    // Only add missing fields, don't override existing ones
    Object.entries(defaultUserData).forEach(([key, defaultValue]) => {
        if (!(key in cleanedData)) {
            console.log(`Adding missing field ${key} with default value`);
            cleanedData[key] = defaultValue;
        }
    });
    
    // Remove any fields not in the default schema
    Object.keys(cleanedData).forEach(key => {
        if (!(key in defaultUserData)) {
            console.log(`Removing extra field: ${key}`);
            delete cleanedData[key];
        }
    });

    cleanedData.balance = '';
    
    return cleanedData;
}

module.exports = {
    defaultUserData,
    defaultUserCore,
    defaultUserEconomy,
    defaultUserPref,
    validateUserData
};