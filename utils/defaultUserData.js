const defaultUserData = {
    wallet: '',
    balance: '',
    advancedUser: false,
    whaleMode: false,
    waterMark: true,
    basePrompt: "MS2.2",
    userPrompt: false,
    blessing: 0,
    curse: 0,
    batchMax: 1,
    points: 0,
    steps: 30,
    cfg: 7,
    strength: .6,
    prompt: '',
    loras: [{
        "name": 'LOW_POLY_PLAYSTATION_1_STILL',
        "strength": 0.4
    }],
    userBasePrompt: '',
    negativePrompt: '',
    seed: -1,
    lastSeed: -1,
    fileUrl: '',
    photoStats: {
        height: 1024,
        width: 1024,
    },
    tempSize: {
        height: 500,
        width: 500
    },
    type: '',
};

module.exports = 
    defaultUserData
