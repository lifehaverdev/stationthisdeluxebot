voiceModels = [
    {
        name: "BAP",
        modelId: "3HZp3vUTOWTRWPWaY47Q"
    },
    {
        name: "miladystation",
        modelId: "165UvtZp7kKnmrVrVQwx"
    },
    {
        name: "trapaholics",
        modelId: "34Qj692rRGjm1fA8zudD"
    },
    {
        name: 'bjork',
        modelId: '6Vn3eARXC50TMEySWrrW'
    },
    {
        name: 'Charlotte',
        modelId: 'zGDDoashdFkU2rlb917O'
    }
]

function getVoiceModelByName(name) {
    const voice = voiceModels.find(voice => voice.name === name);
    return voice ? voice.modelId : 'na';
}

module.exports = { voiceModels, getVoiceModelByName };