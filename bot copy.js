const TelegramBot = require("node-telegram-bot-api");
//const http = require("http");
const fs = require("fs");
const path = require('path');
//const Jimp = require('jimp');
//const sdk = require('api')('@alchemy-docs/v1.0#1qz7y1elt7gubvr');
const { getUserWalletAddress, getBalance } = require ('./utils/checkBalance')
const { generateImage } = require('./commands/make.js')
require("dotenv").config()

let limit = 200000

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Function to handle sending the generated image
async function sendGeneratedImage(chatId, imageBuffer) {
    try {
        const filename = `./tmp/${chatId}_${Date.now()}.png`;
        fs.writeFileSync(filename, imageBuffer, "base64");

        try {
            options = {
                opacity: .8,
                dstPath: filename,
                ratio: .4
            }
            const main = await Jimp.read(filename);
            const watermark = await Jimp.read('./ms2black.png');
            const [newHeight, newWidth] = getDimensions(main.getHeight(), main.getWidth(), watermark.getHeight(), watermark.getWidth(), options.ratio);
            watermark.resize(newWidth, newHeight);
            const positionX = (main.getWidth() - newWidth) / 8;     //Centre aligned
            const positionY = (main.getHeight() - newHeight) - 10/// 2;   //Centre aligned
            watermark.opacity(options.opacity);
            main.composite(watermark,
                positionX,
                positionY,
                Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
            await main.quality(100).writeAsync(options.dstPath);
        } catch (err) {
            console.log(err);
            await bot.sendMessage(chatId,`'ah shit tell dev Error sending generated image:', ${error}`)
        }

        await bot.sendPhoto(chatId, filename);
        fs.unlinkSync(filename);
    } catch (error) {
        console.log("Error sending generated image:", error);
        await bot.sendMessage(chatId,`'ahh shit tell dev Error sending generated image:', ${error}`)
    }
}

// Function to make the API request and handle the response
async function generateImageAndSend(message, prompt) {
    const start = process.hrtime();
    try {

        prompt = prompt.replace("/make", "").trim();

        const key = "ME:"
        let addy = '';
        
        const pullAddy = (prompt) => {
            // console.log(prompt.indexOf(key));
            const keyStart = prompt.indexOf(key) + 3;
            addy = prompt.slice(keyStart,keyStart + 44);
            const keyEnd = addy.indexOf(" ");
            //console.log(keyEnd)
            if(keyEnd > 0){
                addy = addy.slice(0,keyEnd);
            }
            addy = addy.replace(" ","");
            
            //console.log("begin",addy,"end")
            return prompt.split(" ").filter(keyword => !keyword.includes(key)).join(" ");
        }
        
        // Censored words list (replace with your list of words)
        const censoredWords = ["topless","lingerie","stripper","boobs", "titties", "boobies", "breasts", "nude", "naked", "cock", "dick", "penis", "sex", "fuck", "cum", "semen"];
        prompt = pullAddy(prompt)
        const account = await getBalance(addy)
        console.log('user account balance',account);
        if (account < limit){
            await bot.sendMessage(message.chat.id,`NO ACCEsS HAHAHAHA you have ${account} but you need ${limit}`)
            return '';
        } else if (addy == '') {
            await bot.sendMessage(message.chat.id,`try again but include the keyword "ME:" directly followed by your solana address`)
        }
        // Function to filter out censored words from the prompt
        const filterCensoredWords = (prompt) => {
            return prompt.split(" ").filter(word => !censoredWords.includes(word)).join(" ");
        };


        const censoredPrompt = filterCensoredWords(prompt);

        const promptRequest = JSON.stringify({
            sampler_name: process.env.SAMPLER_NAME,
            steps: process.env.STEPS,
            cfg_scale: process.env.CFG_SCALE,
            width: process.env.WIDTH,
            height: process.env.HEIGHT,
            restore_faces: process.env.RESTORE_FACES,
            //prompt: process.env.POSITIVE_PROMPT + prompt,
            prompt: censoredPrompt + ", pixelated, glitchart of close-up, ps1 playstation psx gamecube game radioactive dreams screencapture bryce 3d <lora:LUISAPS2xx:1>",
            negative_prompt: process.env.NEGATIVE_PROMPT
        });

        console.log("Prompt request:", promptRequest); // Log the prompt request

        const options = {
            host: process.env.SD_API_HOST,
            port: process.env.SD_API_PORT,
            path: "/sdapi/v1/txt2img",
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

        console.log("Response status code:", response.statusCode);
        // console.log("Response body:", response.body);

        const result = JSON.parse(response.body);
        if (result && result.images && result.images.length > 0) {
            await sendGeneratedImage(message.chat.id, Buffer.from(result.images[0], "base64"));
        } else {
            console.error("No images found in the response.");
        }
    } catch (error) {
        console.error("Error generating image:", error);
    }
    const end = process.hrtime();
    const time = end[0] - start[0];
    console.log(time);
    if(time > 20 && limit < 1000000){
        limit += 50000;
        console.log('new limit',limit)
    } else if (time < 10 && limit > 0){
        limit -= 50000;
        console.log('new limit',limit)
    }
}

// Event listener for handling text messages
bot.onText(/^\/make (.+)/, async (message) => {
    try {
        await generateImageAndSend(message, message.text);
    } catch (error) {
        console.error("Error handling text message:", error);
    }
});

async function getBalance(address) {
    //console.log('checking balalnce')
    let balance = 0;
    await sdk.getTokenAccountBalance({
        id: 1,
        jsonrpc: '2.0',
        method: 'getTokenAccountsByOwner',
        "params": [
          address,
          {
              "mint": "AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg"
          },
          {
              "encoding": "jsonParsed"
          }
      ]
      }, {apiKey: process.env.ALCHEMY_SECRET})
    .then(({ data }) => {
        //console.log(data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount)
        balance = data.result.value[0].account.data.parsed.info.tokenAmount.uiAmount
    })
    .catch(err => console.error(err));
    //console.log('balance ',balance)
    if(balance){
        return balance
    } else {
        return 0
    }
    
}

const getDimensions = (H, W, h, w, ratio) => {
    let hh, ww;
    if ((H / W) < (h / w)) {    //GREATER HEIGHT
        hh = ratio * H;
        ww = hh / h * w;
    } else {                //GREATER WIDTH
        ww = ratio * W;
        hh = ww / w * h;
    }
    return [hh, ww];
}
