const defaultUserData = {
    userId: '',
    wallet: '',
    balance: '',
    verified: false,
    advancedUser: false,
    whaleMode: false,
    waterMark: true,
    userPrompt: false,
    collections: 0,
    loras: 0,
    basePrompt: "MS2.2",
    checkpoint: "Proteus_V0.4.safetensors",
    blessing: 0,
    curse: 0,
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
    //loraConfig: [
        // {
        //     loraName: '',
        //     loraStrength: 1
        // }
    //],
    collectionConfig: [
        // {
        //     name: '',
        //     size: 100,
        //     basePrompt: '',
        //     subjectPrompt: '',
        //     traits: [
        //         {
        //             name: '',
        //             value: '',
        //             prompt: '',
        //             hidden: true
        //         }
        //     ]
        // }
    ],
    state: {
        state: 'IDLE',
        chatId: null,
        messageThreadId: null
    },
    type: '',
};

module.exports = defaultUserData

