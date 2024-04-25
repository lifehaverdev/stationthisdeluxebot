const http = require("http");
const Jimp = require('jimp');
const fs = require('fs');
const { addWaterMark } = require("../utils/waterMark");
const defaultPrompt = require('../utils/defaultPrompt');
const basepromptmenu = require('../utils/basepromptmenu');


function getBasePromptByName(name) {
    const promptObj = basepromptmenu.find(prompt => prompt.name === name);
    return promptObj ? promptObj.baseprompt : defaultPrompt;
}

async function generateImage2Image(message, promptObj) {
    //console.log(promptObj)

    const start = process.hrtime();
    const chatId = message.chat.id
    let initPrompt = promptObj.prompt
    //console.log(promptObj.prompt,promptObj.cfg,promptObj.strength,promptObj.photoStats,promptObj.fileUrl)

    try {

        trimPrompt = initPrompt != '' ? initPrompt.replace("/ms2", "").trim() : '';
        const ratio = promptObj.photoStats.height / promptObj.photoStats.width;
        let height = promptObj.photoStats.height;
        let width = promptObj.photoStats.width;
        let upscaler;
        if(height > width){
            width = Math.floor(process.env.WIDTH / ratio);
            height = process.env.HEIGHT;
        } else if (width > height) {
            height = Math.floor(process.env.HEIGHT * ratio);
            width = process.env.WIDTH;
        }
        
        // Censored words list (replace with your list of words)
        const censoredWords = ["topless","lingerie","stripper","boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen"];

        // Function to filter out censored words from the prompt
        const filterCensoredWords = (prompt) => {
            return prompt.split(" ").filter(word => !censoredWords.includes(word)).join(" ");
        };

        let censoredPrompt = promptObj.prompt;
        if(!promptObj.whaleMode){
            censoredPrompt = filterCensoredWords(trimPrompt);
        }
        let basePrompt = getBasePromptByName(promptObj.basePrompt);
        //promptObj.whaleMode && !promptObj.basePrompt ? basePrompt = '' : basePrompt = defaultPrompt;

        let userBasePrompt;
        promptObj.userBasePrompt != '' && promptObj.userPrompt ? userBasePrompt = promptObj.userBasePrompt : userBasePrompt = '';
        const promptRequest = JSON.stringify({
            prompt: censoredPrompt + userBasePrompt + basePrompt,
            negative_prompt: process.env.NEGATIVEPROMPT + promptObj.negativePrompt,
            styles: [
                ""
              ],
            seed: promptObj.seed,
            subseed: -1,
            subseed_strength: 0,
            seed_resize_from_h: -1,
            seed_resize_from_w: -1,
            sampler_name: process.env.SAMPLER_NAME,
            batch_size: promptObj.batchMax,
            n_iter: 1,
            steps: promptObj.steps,
            cfg_scale: promptObj.cfg,
            width: width,
            height: height,
            restore_faces: process.env.RESTORE_FACES,
            tiling: false,
            do_not_save_samples: true,
            do_not_save_grid: true,
            eta: 0,
            denoising_strength: promptObj.strength,
            s_min_uncond: 0,
            s_churn: 0,
            s_tmax: 0,
            s_tmin: 0,
            s_noise: 0,
            override_settings: {},
            override_settings_restore_afterwards: true,
            // refiner_checkpoint: 
            // refiner_switch_at: 0,
            disable_extra_networks: false,
            firstpass_image: promptObj.fileUrl,
            comments: {},
            init_images: [
                promptObj.fileUrl,
            ],
            resize_mode: 0,
            image_cfg_scale: 0,
            //mask:

        });

        //console.log("Img2Img Prompt request:", promptRequest.prompt); // Log the prompt request

            //to save time
        const options = {
            host: process.env.SD_API_HOST,
            port: process.env.SD_API_PORT,
            path: "/sdapi/v1/img2img",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(promptRequest)
            }
        };

        const response = await new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
            });

            req.on("error", reject);
            req.write(promptRequest);
            req.end();
        });

        //console.log("Response status code:", response.statusCode);
        // console.log("Response body:", response.body);

        const result = JSON.parse(response.body);
        if (response.statusCode == 200 && result && result.images && result.images.length > 0) {
            let filenames = [];
            for(let i = 0; i < result.images.length; i++){
                filenames.push(`./tmp/${chatId}_${Date.now()}${i}.png`);
                fs.writeFileSync(filenames[i], Buffer.from(result.images[i], "base64"), 'base64');
                if(promptObj.waterMark){
                    await addWaterMark(filenames[i])
                }
            }
            //fs.writeFileSync(filenames[0], Buffer.from(result.images[0], "base64"), 'base64');

            // if(promptObj.waterMark){
            //     await addWaterMark(filenames[0]);
            // }

            const end = process.hrtime();
            const time = end[0] - start[0];
            //console.log(time);
            const receipt = {
                time: time,
                filenames: filenames
            }
            return receipt;

        } else {
            console.error("No images found in the response.");
            const receipt = {
                time: null,
                filenames: null
            }
            return receipt;
        }
    } catch (error) {
        console.error("Error generating image:", error);
    }

}

module.exports = {
    generateImage2Image
}