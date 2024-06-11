const http = require("http");
const fs = require('fs');

  
const main = async (message, voiceModel) => {

    const options = {
        method: 'POST',
        headers: {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": process.env.ELEVEN_LABS
        },
        body: JSON.stringify(
            {
                "text": message.text,
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
            throw new Error('Network response was not ok');
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const fileName = `./tmp/speak${message.from.first_name}${Math.floor(Date.now() % 1000)}.mp3`;
        fs.writeFileSync(fileName, buffer);

        return fileName;
    } catch (err) {
        console.error(err);
        throw err;
    }
    
}


// Function to make the API request and handle the response
async function txt2Speech(message, voiceModel) {
    //const start = process.hrtime();
    try {
        const result = await main(message, voiceModel);
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