const defaultUserData = {
    userId: '',
    wallet: '',
    balance: '',
    verified: false,
    advancedUser: false,
    basePrompt: "MS2",
    checkpoint: "zavychromaxl_v60",
    voiceModel: "165UvtZp7kKnmrVrVQwx",
    batchMax: 1,
    exp: 0,
    points: 0,
    doints: 0,
    qoints: 0,
    boints: 0,
    steps: 30,
    cfg: 7,
    strength: .6,
    prompt: '',
    userBasePrompt: '-1',
    negativePrompt: '-1',
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

