const http = require("http");
const OpenAI = require("openai");
require('dotenv').config();

//console.log(process.env.OPENAI_API);
const openai = new OpenAI({apiKey: process.env.OPENAI_API});
// Initialize a separate OpenAI client for uncensored access
const unrestrictedAI = new OpenAI({
    baseURL: "https://llm-gateway.heurist.xyz",
    apiKey: process.env.HEURIST // Make sure to add this to your environment variables
});
async function main(input, unrestricted = false) {
    console.log('main called with unrestricted:', unrestricted);
    
    // Define the messages/instructions once
    const messages = [
        {"role": "user", "content": `make a word list prompt for SDXL for "Chtullu deep under the sea"`},
        {"role": "system", "content": `Cthulhu, deep sea, underwater, ancient, mythical, Lovecraftian, tentacles, eldritch horror, submerged, dark waters, ocean depths, marine mystery, aquatic terror, forbidden, monstrous deity, shadowy, immense size, otherworldly, sunken ruins, eerie, bioluminescence, sinister presence`},
        {"role": "system", "content": "You are a helpful SDXL prompt engineer assistant. Create comma-separated word lists that work well with SDXL. Focus on descriptive terms, artistic styles, and atmospheric elements."},
        {"role": "user", "content": `make a word list prompt for SDXL for ${input}`}
    ];

    try {
        if (unrestricted) {
            console.log('Using unrestricted API');
            return await getUnrestrictedCompletion(messages);
        } else {
            console.log('Using restricted OpenAI API');
            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-3.5-turbo",
                temperature: 0.7,
            });
            return completion.choices[0].message.content;
        }
    } catch (error) {
        console.error('Error in main:', error);
        throw error;
    }
}
async function mainFlux(input, unrestricted = false) {
    console.log('mainFlux called with unrestricted:', unrestricted);
    
    // Define the messages/instructions once
    const messages = [
        {"role": "system", "content": `You are a FLUX prompt engineer specializing in creating clear image descriptions. 
Your prompts must:
- Start EXACTLY with "This image is a" or "This image is an" (no other prefixes or preambles)
- Include specific details about the main subject and surrounding elements
- Describe the lighting, colors, and atmosphere
- Incorporate creative or unexpected elements
- Mention digital art techniques or stylistic choices
- Be descriptive but concise, around 100-200 words
- Include specific positioning (left, right, background, etc.)
- Describe textures and materials where relevant
- NEVER include phrases like "FLUX-generated" or "FLUX prompt" in the output
- Focus purely on describing the image itself`},
        {"role": "user", "content": "Create a FLUX prompt about a cat programmer"},
        {"role": "assistant", "content": `This image is a digital artwork showing a focused tabby cat working at a modern desk...`},
        {"role": "user", "content": `make a prosaic prompt for FLUX image generation of ${input}`}
    ];

    try {
        if (unrestricted) {
            console.log('Using unrestricted API');
            return await getUnrestrictedCompletion(messages);
        } else {
            console.log('Using restricted OpenAI API');
            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-4",
                temperature: 1.0,
            });
            return completion.choices[0].message.content;
        }
    } catch (error) {
        console.error('Error in mainFlux:', error);
        throw error;
    }
}

// Function to make the API request and handle the response
async function promptAssist(message, flux, unrestricted = false) {
    const start = process.hrtime();
    let result;
    try {
        
        if(flux){
            result = await mainFlux(message.text,unrestricted);
        } else {
            result = await main(message.text,unrestricted);
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

// Modify your existing gptAssist function to handle unrestricted access
async function gptAssist({ messages, model = "gpt-4", temperature = 0.7, formatResult = (content) => content, unrestricted = false }) {
    const start = process.hrtime();
    
    try {
        let result;
        
        if (unrestricted) {
            // Use unrestricted API
            console.log('we are using unrestricted api')
            result = await getUnrestrictedCompletion(messages, temperature);
        } else {
            // Use regular OpenAI API
            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                temperature: temperature,
            });
            result = completion?.choices?.[0]?.message?.content;
        }

        if (result) {
            console.log('result',result)
            const formattedResult = formatResult(result);
            const end = process.hrtime();
            
            return {
                time: end[0] - start[0],
                result: formattedResult
            };
        }
        
        return null;
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
            // First try direct parse
            return JSON.parse(content);
        } catch (e) {
            console.log('Initial JSON parse failed, attempting to clean content...');
            console.log('Raw content:', content);
            
            // Clean the string of control characters and normalize line endings
            const cleaned = content
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control chars
                .replace(/\n\s*/g, ' ')                        // Normalize line endings and remove extra spaces
                .replace(/\r/g, '')                           // Remove carriage returns
                .replace(/\t/g, ' ')                          // Replace tabs with spaces
                .replace(/\s+/g, ' ')                         // Collapse multiple spaces
                .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')      // Escape backslashes
                .trim();                                      // Trim extra whitespace
            
            console.log('Cleaned content:', cleaned);
            
            try {
                return JSON.parse(cleaned);
            } catch (e2) {
                console.warn("Could not parse JSON response even after cleaning:", e2);
                // Instead of throwing, return null to indicate parsing failure
                return null;
            }
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

// Add this before module.exports



// Function for uncensored streaming completion
async function* streamUnrestrictedCompletion(messages, temperature = 0.75, maxTokens = 1024) {
    try {
        const stream = await unrestrictedAI.chat.completions.create({
            model: "mistralai/mixtral-8x7b-instruct",
            messages: messages,
            stream: true,
            temperature: temperature,
            max_tokens: maxTokens,
        });

        for await (const chunk of stream) {
            yield chunk.choices[0].delta.content;
        }
    } catch (error) {
        console.error("Error in streaming unrestricted completion:", error);
        throw error;
    }
}

// Function for uncensored non-streaming completion
async function getUnrestrictedCompletion(messages, temperature = 0.75, maxTokens = 1024) {
    try {
        const result = await unrestrictedAI.chat.completions.create({
            //model: "mistralai/mixtral-8x7b-instruct", //censored
            //model: "openhermes-mixtral-8x7b-gptq", //not good
            model: "dolphin-2.9-llama3-8b",
            messages: messages,
            stream: false,
            temperature: temperature,
            max_tokens: maxTokens,
        });

        return result.choices[0].message.content;
    } catch (error) {
        console.error("Error in unrestricted completion:", error);
        throw error;
    }
}


module.exports = {
    promptAssist,
    gptAssist,
    formatters
}