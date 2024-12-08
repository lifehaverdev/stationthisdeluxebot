const { lobby } = require('../utils/bot/bot');
const http = require("http");
const fs = require('fs');

const main = async (message, voiceModel, voiceName, customFileNames) => {
    let textToSpeak = message.text;
    let customFileName = '';

    if (customFileNames) {
        if (message.text.includes('|')) {
            // Split on first | character
            const parts = message.text.split('|');
            textToSpeak = parts[0].trim();
            
            // Clean the filename part - remove special chars except alphanumeric and dashes
            customFileName = parts[1].trim().replace(/[^a-zA-Z0-9-]/g, '');
        }
        
        // If no valid custom filename provided, use fallback from user preferences
        if (!customFileName) {
            customFileName = lobby[message.from.id].customFileName || `speak${voiceName}${Math.floor(Date.now() % 1000)}`;
        }
    }

    const options = {
        method: 'POST',
        headers: {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": process.env.ELEVEN_LABS
        },
        body: JSON.stringify(
            {
                "text": textToSpeak,
                "model_id":"eleven_multilingual_v2",
                "voice_settings":
                    {
                        "stability":0.5,
                        "similarity_boost":0.5,
                        "style":0.5,
                        "use_speaker_boost":true
                    },
                "seed": Math.floor(Math.random()*100)
            })
    };

    console.log('trying this',`https://api.elevenlabs.io/v1/text-to-speech/${voiceModel}`, options)

    try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceModel}`, options);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Response Status:', response.status);
            console.error('Response Body:', errorText);
            throw new Error('Network response was not ok');
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const dir = './tmp';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }

        const fileName = customFileName ? 
            `./tmp/${customFileName}.mp3` :
            `./tmp/speak${voiceName}${Math.floor(Date.now() % 1000)}.mp3`;
            
        fs.writeFileSync(fileName, buffer);
        
        if(fs.existsSync(fileName)){
            return fileName;
        } else {
            return '-1';
        }
        
    } catch (err) {
        console.error(err);
        throw err;
    }
}


// Function to make the API request and handle the response
async function txt2Speech(message, voiceModel, voiceName, customFileNames) {
    //const start = process.hrtime();
    try {
        const result = await main(message, voiceModel, voiceName, customFileNames);
        if (result) {
            return result;
        } else {
            console.error("No result from gpt.");
        }
    } catch (error) {
        console.error("Error generating speak:", error);
    }
}

module.exports = { txt2Speech }