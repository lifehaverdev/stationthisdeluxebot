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
            {"role": "system", "content": `You are a FLUX prompt engineer specializing in creating detailed, surreal image descriptions. 
Your prompts should:
- Begin with "This image is a..."
- Include specific details about the main subject and surrounding elements
- Describe the lighting, colors, and atmosphere
- Incorporate surreal or unexpected elements
- Mention digital art techniques or stylistic choices
- Be highly detailed and descriptive, around 200-300 words
- Focus on fantastical, surreal, or absurd scenarios
- Include specific positioning (left, right, background, etc.)
- Describe textures and materials where relevant`},
            
            {"role": "user", "content": "Create a FLUX prompt about a cat programmer"},
            
            {"role": "assistant", "content": `This image is a digital artwork depicting a surreal office scene where a tabby cat sits at a floating holographic desk. The cat wears thick-rimmed glasses and a miniature programmer's hoodie, its paws expertly typing on a keyboard made of crystalline light. Multiple monitors hover around the cat, displaying cascading lines of glowing code in neon green and electric blue.

In the background, circuit board patterns stretch across the walls, occasionally sparking with small bursts of digital energy. Floating mechanical mice, constructed from transparent silicon and blinking LED lights, orbit around the cat's workspace like satellites. The left side of the image features a towering stack of energy drink cans that defy gravity, arranged in a double helix pattern.

The lighting is predominantly cyberpunk-inspired, with strong purple and teal undertones that cast a technological glow across the scene. Small holographic error messages and compilation warnings materialize and dissolve in the air like digital fireflies. The cat's fur has a slight pixel distortion effect, suggesting a glitch in the digital reality. The overall atmosphere is both whimsical and technologically advanced, blending organic and digital elements in a seamless, surreal composition.`},
            
            {"role": "user", "content": `make a prosaic prompt for FLUX image generation of ${input}`}
        ],
        model: "gpt-4", // Upgraded to GPT-4 for better descriptive capabilities
        temperature: 1.2, // Increased temperature for more creative outputs
    });
    
    console.log('assist', input);
    return completion.choices[0].message.content;
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