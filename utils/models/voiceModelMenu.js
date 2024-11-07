voiceModels = [
    {
        name: "BAP",
        modelId: "3HZp3vUTOWTRWPWaY47Q"
    },
    // {
    //     name: "miladystation",
    //     modelId: "165UvtZp7kKnmrVrVQwx"
    // },
    {
        name: "evil empire",
        modelId: "34Qj692rRGjm1fA8zudD"
    },
    {
        name: 'bjork',
        modelId: '6Vn3eARXC50TMEySWrrW'
    },
    {
        name: 'Charlotte',
        modelId: 'zGDDoashdFkU2rlb917O'
    },
    {
        name: 'Jordan',
        modelId: 'baXUaMbdXzShhJFwCRJZ'
    },
    {
        name: 'Joe',
        modelId: 'eJnCdPneH7e8OxO6azGV'
    },
    {
        name: 'Dom',
        modelId: 'mO9CvFCq3LacDoevi4kO'
    }
]

function getVoiceModelByName(name) {
    const voice = voiceModels.find(voice => voice.name === name);
    return voice ? voice.modelId : 'na';
}

module.exports = { voiceModels, getVoiceModelByName };