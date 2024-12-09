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
            {"role": "system", "content": `You are a FLUX prompt engineer specializing in creating clear image descriptions. 
Your prompts should:
- Begin with "This image is a..."
- Include specific details about the main subject and surrounding elements
- Describe the lighting, colors, and atmosphere
- Incorporate creative or unexpected elements
- Mention digital art techniques or stylistic choices
- Be descriptive but concise, around 100-200 words
- Include specific positioning (left, right, background, etc.)
- Describe textures and materials where relevant`},
            
            {"role": "user", "content": "Create a FLUX prompt about a cat programmer"},
            
            {"role": "assistant", "content": `This image is a digital artwork showing a focused tabby cat working at a modern desk. The cat wears small rectangular glasses and a navy programmer's hoodie, typing with its paws on a sleek keyboard. Three monitors float in front of the cat, displaying neat rows of code in a soft blue glow.

The desk area is clean and minimalist, with a few personal touches like a coffee mug and a small potted succulent. In the background, subtle circuit patterns trace across the wall in muted blues and silvers. A few holographic windows hover nearby, showing program interfaces and status messages.

The lighting is warm but technical, with the main light source coming from the monitors, creating a cozy tech atmosphere. The cat's fur is rendered in sharp detail, with slight digital enhancement that makes it seem to shimmer. The overall mood is focused but relaxed, blending the natural and digital worlds.`},
            
            {"role": "user", "content": `make a prosaic prompt for FLUX image generation of ${input}`}
        ],
        model: "gpt-4",
        temperature: 1.0, // Slightly reduced temperature for more grounded outputs
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

// Generic GPT interaction function
async function gptAssist({ messages, model = "gpt-4", temperature = 0.7, formatResult = (content) => content }) {
    const start = process.hrtime();
    
    // Add system message to handle refusals uniformly
    const messagesWithRefusalHandling = [
        {
            role: "system", 
            content: "You are a helpful AI assistant. If you cannot or should not fulfill a request for any reason (ethical concerns, unclear instructions, etc), respond only with 'NOICANT'. Otherwise, proceed with the request as normal."
        },
        ...messages
    ];

    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messagesWithRefusalHandling,
            temperature: temperature,
        });

        if (completion?.choices?.[0]?.message?.content) {
            // Check if response is the refusal token
            if (completion.choices[0].message.content.trim() === 'NOICANT') {
                return null;
            }
            
            const result = formatResult(completion.choices[0].message.content);
            const end = process.hrtime();
            
            return {
                time: end[0] - start[0],
                result
            };
        } else {
            console.error("No valid response from GPT");
            return null;
        }
    } catch (error) {
        console.error("Error in gptAssist:", error);
        throw error;
    }
}

// Format functions
const formatters = {
    // Returns raw text
    raw: (content) => content,
    
    // Formats as JSON if possible
    json: (content) => {
        try {
            return JSON.parse(content);
        } catch (e) {
            console.warn("Could not parse JSON response:", e);
            return content;
        }
    },
    
    // Formats as comma-separated list
    list: (content) => content.split(',').map(item => item.trim()),

    // Formats trait values in name|prompt|rarity format
    traits: (content) => {
        // Split on newlines and filter empty lines
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
                const [name, prompt, rarity] = line.split('|').map(s => s.trim());
                // Validate format
                if (!name || !prompt || !rarity) {
                    throw new Error('Invalid trait format');
                }
                return `${name}|${prompt}|${rarity}`;
            })
            .join('\n');
    },

    // Formats master prompt with trait type placeholders
    masterPrompt: (content) => {
        // Ensure trait types are properly formatted with double brackets
        return content.replace(/\[\[([^\]]+)\]\]/g, (_, type) => `[[${type.trim()}]]`);
    }
};


module.exports = {
    promptAssist,
    gptAssist,
    formatters
}