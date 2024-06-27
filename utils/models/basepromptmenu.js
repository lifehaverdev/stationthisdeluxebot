const basepromptmenu = [
    {
        name: "empty",
        description: "This removes the base prompt",
        baseprompt: ""
    },
    {
        name: '$CULT',
        description: 'ominous smiley man',
        baseprompt: 'remilia <lora:remilia:1>'
    },
    {
        name: "petravoice",
        description: "babes by petravoice",
        baseprompt: "simple_background, portrait, close-up, blurry, depth_of_field, chromatic_aberration, film_grain, <lora:petravoice3:1> petravoice"
    },
    {
        name: "13<33",
        description: "heavenly angel",
        baseprompt: "blue_theme, glowing, 3d, magic, crystal, magic_circle, <lora:13angel332:1> 13angel33"
    },
    {
        name: 'ediblekawaii',
        description: 'edible kawaii demonization',
        baseprompt: "figure, 3d, simple_background, gradient_background, colored_sclera, gem, gummy, <lora:ediblekawaii:1>"
    },
    {
        name: "MS2",
        description: "MS2 base prompt competition 1st place winner (default)",
        baseprompt: `playstation 1 still, low poly <lora:LOW_POLY_PLAYSTATION_1_STILL:0.5>`
    },
    {
        name: "MS2.1.5",
        description: "MS2 Base prompt but on SD1.5",
        baseprompt: `ps1 style <lora:RW_PS1v1:0.7>`
    },
    {
        name: "MS2.1",
        description: "OG MS2 base prompt",
        baseprompt: "pixelated glitchart of close-up ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d <lora:LOW_POLY_PLAYSTATION_1_STILL:0.5> playstation 1 still low poly"
    },
    {
        name: "alexMS2",
        description: "Kingdom Hearts",
        baseprompt: `Final Fantasy, Kingdom Hearts, low polygon, playstation 2, 2001-era graphics, Y2K, 90s NES 3d model, destiny islands beach in background
        (((LOW POLYGON LOW RESOLUTION)))`
    },
    
];

function getBasePromptByName(name) {
    const promptObj = basepromptmenu.find(prompt => prompt.name === name);
    return promptObj ? promptObj.baseprompt : defaultPrompt;
}

const defaultPrompt = "<lora:LOW_POLY_PLAYSTATION_1_STILL:0.7> playstation 1 still low poly"


module.exports = { basepromptmenu, defaultPrompt, getBasePromptByName };