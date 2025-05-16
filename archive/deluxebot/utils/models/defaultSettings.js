const defaultModelSettings = {
    SAMPLER_NAME:"DPM++ 2M Karras",
    STEPS:30,
    BATCH:1,
    CFG_SCALE:7.5,
    WIDTH:1024,
    HEIGHT:1024,
    RESTORE_FACES:false,
    PROMPT:"pixelated glitchart of close-up ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d <lora:LUISAPS2xx:1>",
    NEGATIVE_PROMPT:"easy negative",
    STRENGTH:.6,
}

module.exports = defaultModelSettings;