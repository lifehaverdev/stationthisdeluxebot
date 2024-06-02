const defaultUserData = {
    userId: '',
    wallet: '',
    balance: '',
    verified: false,
    advancedUser: false,
    waterMark: true,
    basePrompt: "MS2.2",
    checkpoint: "Proteus_V0.4.safetensors",
    voiceModel: "165UvtZp7kKnmrVrVQwx",
    batchMax: 1,
    points: 0,
    steps: 30,
    cfg: 7,
    strength: .6,
    prompt: '',
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
    state: {
        state: 'IDLE',
        chatId: null,
        messageThreadId: null
    },
    type: '',
};

module.exports = defaultUserData

