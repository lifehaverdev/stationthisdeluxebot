
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

async function mainFlux(input) {
    const completion = await openai.chat.completions.create({
  
      messages: [
          {"role": "user", "content": `make a prosaic prompt for FLUX image generation of "beautiful girl, fish eye"`},
          {"role": "system", "content": `A warm golden hour scene in the style of Wes Anderson, with a shallow depth of field, slight film grain, and a soft, pastel color palette. A young Asian woman with long, dark hair and porcelain skin is centered in the frame, wearing a white crop top, denim shorts, and a delicate silver bracelet. Her eyes are cast forward, with a gentle, introspective expression, as she tilts her head slightly to one side and touches her hair with her hand. The lush greenery of a nearby cafe garden is blurred in the background, with a few leaves and branches encroaching into the frame. The lighting is soft and natural, with a warm glow casting a gentle highlight on the subject's face. The overall mood is serene and contemplative, with a sense of quiet reflection.`},
          {"role": "system", "content": "You are a helpful FLUX prompt engineer assistant."},
          {"role": "user", "content": `make a prosaic prompt for FLUX image gernation of  ${input}`},
          ],
      model: "gpt-3.5-turbo",
    });
    //console.log(completion.choices[0]);
    console.log('assist',input);
    //console.log('chat response: ',completion.choices[0].message.content);
    return completion.choices[0].message.content
  }

// Function to make the API request and handle the response
async function promptAssist(message, flux) {
    const start = process.hrtime();
    let result;
    try {
        
        if(flux){
            result = await mainFlux(message.text);
        } else {
            result = await main(message.text);
        }
        
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