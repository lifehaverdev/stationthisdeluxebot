
const http = require("http");
const OpenAI = require("openai");
//console.log(process.env.OPENAI_API);
const openai = new OpenAI({apiKey: process.env.OPENAI_API});

async function main(input) {
  const completion = await openai.chat.completions.create({

    messages: [
        {"role": "user", "content": `make a word list prompt for SDXL for "Chtullu deep under the sea"`},
        {"role": "system", "content": `Cthulhu, deep sea, underwater, ancient, mythical, Lovecraftian, tentacles, eldritch horror, submerged, dark waters, ocean depths, marine mystery, aquatic terror, forbidden, monstrous deity, shadowy, immense size, otherworldly, sunken ruins, eerie, bioluminescence, sinister presence`},
        {"role": "system", "content": "You are a helpful SDXL prompt engineer assistant."},
        {"role": "user", "content": `make a word list prompt for SDXL for  ${input}`},
        ],
    model: "gpt-3.5-turbo",
  });
  //console.log(completion.choices[0]);
  console.log('assist',input);
  //console.log('chat response: ',completion.choices[0].message.content);
  return completion.choices[0].message.content
}

// Function to make the API request and handle the response
async function promptAssist(message) {
    const start = process.hrtime();
    try {
        const result = await main(message.text);
        if (result) {
            console.log('assisted',result);
            const end = process.hrtime();
            const time = end[0] - start[0];
            //console.log(time);
            const receipt = {
                time: time,
                result: result
            }
            return receipt;

        } else {
            console.error("No result from gpt.");
        }
    } catch (error) {
        console.error("Error generating assist:", error);
    }
}


module.exports = {
    promptAssist
}