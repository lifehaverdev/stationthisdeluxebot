const basepromptmenu = [
    {
        name: "empty",
        description: "This removes the base prompt",
        baseprompt: ""
    },
    {
        name: "MS2.2",
        description: "MS2 base prompt competition 1st place winner (default)",
        baseprompt: `close-up ps1 ps2 playstation gamecube game, radioactive dreams screencapture bryce 3d, PS2-maximized, boundary-pushing, sharp-crisp-graphics, highly-recognizable, peak-console-performance, visual-style, crunchy-aesthetic, low-res-textures:0.5, gritty-grainy-detail, polygonal-models:0.8, sharp-edges, distinct-corners, simplified-3D-forms, saturated-colors, moody-ambiance, high-contrast-lighting, dramatic-shadows, deep-space-perception, graphical-constraints, pronounced-aliasing, jagged-edges, smoothness-in-lower-frame-rates, vibrant-early-2000s-look, low-poly:0.7, Playstation2-style,{weight=0.3: "pixelated glitch-art:0.6, playstation game, psx game, gamecube game, radioactive dreams, bryce 3d, playstation1, still, low poly <lora:ps1_style_SDXL_v2:0.5>"}`
    },
    {
        name: "MS2.1.5",
        description: "MS2 Base prompt but on SD1.5",
        baseprompt: `close-up ps1 ps2 playstation gamecube game, radioactive dreams screencapture bryce 3d, PS2-maximized, boundary-pushing, sharp-crisp-graphics, highly-recognizable, peak-console-performance, visual-style, crunchy-aesthetic, low-res-textures:0.5, gritty-grainy-detail, polygonal-models:0.8, sharp-edges, distinct-corners, simplified-3D-forms, saturated-colors, moody-ambiance, high-contrast-lighting, dramatic-shadows, deep-space-perception, graphical-constraints, pronounced-aliasing, jagged-edges, smoothness-in-lower-frame-rates, vibrant-early-2000s-look, low-poly:0.7, Playstation2-style,{weight=0.3: "pixelated glitch-art:0.6, playstation game, psx game, gamecube game, radioactive dreams, bryce 3d, playstation1, still, low poly <lora:RW_PS1v1:0.7>"}`
    },
    {
        name: "MS2.1",
        description: "OG MS2 base prompt",
        baseprompt: "pixelated glitchart of close-up ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d <lora:ps1_style_SDXL_v2:0.5> playstation 1 still low poly"
    },
    {
        name: "konaS2",
        description: "MS2 base prompt competition 2nd place winner",
        baseprompt: `craft low-polygonal, pixelated retro PlayStation 1 graphics, inspired by PSX games, GameCube games, and 'Radioactive Dreams.' ((emphasize early 2000s 3D rendering limitations with visible polygons, pixelation, and texture stretching)). Use Bryce 3D imagery for era charm, dithering, and color banding. Include screen captures highlighting iconic PS1 graphics quirks: low texture resolution, low polygon count, simple shapes. Maintain a retro vibe with flat shading, limited colors, and basic shapes. Enhance depth with subtle occlusion and specular highlights. Use dynamic shadows and motion blur sparingly due to hardware constraints. Reference image <lora:ps1_style_SDXL_v2:0.7> for nostalgia. Low poly PlayStation 1 style`
    },
    {
        name: "memesteenS2",
        description: "MS2 base prompt competition 3rd place winner",
        baseprompt: ` ps1 graphics, game footage, screen capture, ((3D render)), gameplay, texture dithering, low res texturing, playstation gameplay screen capture, ((ps1 playstation psx style)) gamecube game screencapture bryce 3D <lora:ps1_style_SDXL_v2:0.8> ((playstation 1 still low poly)) crispy sharp image, playstation gameplay screen capture, n64 game, dithering low res texture, low poly psx model, <lora:PLAYSTATIONRETROV2_LOWPOLY_PS1_PIXELATED:0.6> PLAYSTATIONRETROV2 LOWPOLY PS1 PIXELATED`
    },
    {
        name: "brainMS2",
        description: "arthurts wife's favorite",
        baseprompt: `<lora:ps1_style_SDXL_v2:.8> LOW POLY PLAYSTATION 1 STILL playstation1 graphics, Low-polygon, Limited color palettes, Texture warping,Retro gaming aesthetic, Blocky models, Blurred backgrounds, Early 3D video games, Late 90s video games`
    },
    {
        name: "alexMS2",
        description: "Kingdom Hearts",
        baseprompt: `Final Fantasy, Kingdom Hearts, low polygon, playstation 2, 2001-era graphics, Y2K, 90s NES 3d model, destiny islands beach in background
        (((LOW POLYGON LOW RESOLUTION)))`
    }
];


const defaultPrompt = "pixelated glitchart of close-up ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d <lora:LOW_POLY_PLAYSTATION_1_STILL:0.7> playstation 1 still low poly"


module.exports = { basepromptmenu, defaultPrompt };