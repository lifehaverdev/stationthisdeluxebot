const basepromptmenu = [
    {
        name: "empty",
        description: "This removes the base prompt",
        baseprompt: ""
    },
    {
        name: "wifeystation",
        description: "actual wifeystationmode",
        baseprompt: "ws2, (petravoice) a cartoon woman, bold makeup, red lipstick, glsl - shaders, smooth soft focus, imagenet, twitter pfp, beautifully dithered gradients, low poly9 stardew valley character, upper body avatar, fluffy, hyperrealistic, toon aesthetic, low poly low resolution, pixelated graphics, blocky textures, retro game"
    },
    {
        name: '$CULT',
        description: 'ominous smiley man',
        baseprompt: 'remilia'
    },
    {
        name: "petravoice",
        description: "babes by petravoice",
        baseprompt: "simple_background, portrait, close-up, blurry, depth_of_field, chromatic_aberration, film_grain, petravoice"
    },
    {
        name: "13<33",
        description: "heavenly angel",
        baseprompt: "blue_theme, glowing, 3d, magic, crystal, magic_circle, 13angel33"
    },
    {
        name: 'ediblekawaii',
        description: 'edible kawaii demonization',
        baseprompt: "figure, 3d, simple_background, gradient_background, colored_sclera, gem, gummy"
    },
    {
        name: "MS2",
        description: "MS2 base prompt competition 1st place winner (default)",
        baseprompt: `playstation 1 still5, low poly`
    },
    // {
    //     name: "MS2.1.5",
    //     description: "MS2 Base prompt but on SD1.5",
    //     baseprompt: `ps1 style <lora:RW_PS1v1:0.7>`
    // },
    {
        name: "MS2.1",
        description: "OG MS2 base prompt",
        baseprompt: "pixelated glitchart of close-up ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d playstation 1 still low poly5"
    },
    {
        name: "alexMS2",
        description: "Kingdom Hearts",
        baseprompt: `Final Fantasy, Kingdom Hearts, low polygon, playstation 2, 2001-era graphics, Y2K, 90s NES 3d model, destiny islands beach in background
        (((LOW POLYGON LOW RESOLUTION)))`
    },
    
];

function getBasePromptByName(name) {
    console.log('name sent to getBasePromptByName',name)
    const basePrompt = basepromptmenu.find(prompt => prompt.name === name);
    console.log('baseprompt found',basePrompt)
    return basePrompt ? basePrompt.baseprompt : defaultPrompt;
}

const defaultPrompt = "playstation 1 still7 low poly"


module.exports = { basepromptmenu, defaultPrompt, getBasePromptByName };