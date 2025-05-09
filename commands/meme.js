// Import necessary libraries
const Jimp = require('jimp');
const { createCanvas, loadImage } = require('canvas');
//const { getPhotoUrl, lobby } = require('../utils/bot/bot');
//const { sendPhoto, react } = require('../utils/utils');
//const { checkIn } = require('../utils/bot/gatekeep');
const fs = require('fs');
const path = require('path');

// Function to add text to an image
async function addTextToImage(imagePath, upperText, lowerText, uniqueId) {
    try {
        console.log(`Attempting to load image from: ${imagePath}`);
        const image = await loadImage(imagePath);
        console.log(`Image loaded: width=${image.width}, height=${image.height}`);
        
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        console.log('Canvas context obtained.');

        // Draw the original image
        ctx.drawImage(image, 0, 0, image.width, image.height);
        console.log('Image drawn on canvas.');

        // Text styling
        const fontSize = Math.floor(image.height / 10);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = Math.floor(fontSize / 10);
        ctx.textAlign = 'center';
        console.log('Text style set.');

        const margin = Math.floor(image.height / 20);

        if (upperText) {
            ctx.textBaseline = 'top';
            ctx.strokeText(upperText.toUpperCase(), image.width / 2, margin);
            ctx.fillText(upperText.toUpperCase(), image.width / 2, margin);
            console.log(`Upper text "${upperText}" drawn.`);
        }

        if (lowerText) {
            ctx.textBaseline = 'bottom';
            ctx.strokeText(lowerText.toUpperCase(), image.width / 2, image.height - margin);
            ctx.fillText(lowerText.toUpperCase(), image.width / 2, image.height - margin);
            console.log(`Lower text "${lowerText}" drawn.`);
        }

        const tempMemePath = path.resolve('/tmp', `meme_${uniqueId}.jpg`);
        console.log(`Resolved temporary file path: ${tempMemePath}`);
        
        const out = fs.createWriteStream(tempMemePath);
        out.on('open', () => console.log(`Output stream opened for: ${tempMemePath}`))
           .on('error', (err) => console.error(`Output stream error for ${tempMemePath}:`, err));

        console.log('Creating JPEG stream...');
        const stream = canvas.createJPEGStream({
            quality: 0.95,
            chromaSubsampling: false,
            progressive: false
        });
        stream.on('error', (err) => console.error('JPEG stream error:', err));

        console.log(`Piping JPEG stream to: ${tempMemePath}`);
        stream.pipe(out);
        
        return new Promise((resolve, reject) => {
            out.on('finish', () => {
                console.log(`Output stream finished for: ${tempMemePath}. Checking if file exists...`);
                if (fs.existsSync(tempMemePath)) {
                    console.log(`File confirmed to exist at: ${tempMemePath}`);
                    resolve(tempMemePath);
                } else {
                    console.error(`File NOT found at: ${tempMemePath} after finish event.`);
                    reject(new Error(`File not found after stream finish: ${tempMemePath}`));
                }
            });
            // The 'error' for out stream is already handled above, but we can also reject the promise here
            // out.on('error', reject); // This might cause unhandled promise rejection if also handled above
        });

    } catch (error) {
        console.error('Error in addTextToImage:', error);
        throw error;
    }
}

// Main function to handle the meme command
async function meme(message) {
    console.log('Meme command received');
    if (!lobby.hasOwnProperty(message.from.id)) {
        await checkIn(message);
    }

    const target = message.reply_to_message;
    const messageText = message.text || ''; // Ensure message.text is not undefined
    const parts = messageText.split('|').map(part => part.trim());
    const commandParts = parts[0].split(' '); // Split the first part by space to remove the command
    const upperText = commandParts.slice(1).join(' '); // Join the parts after the command
    const lowerText = parts[1] || ''; // If there's no '|', lowerText will be empty

    if (target && target.photo && (upperText || lowerText)) {
        target.from.id = message.from.id; // Preserve original sender for gatekeeping or other checks if necessary
        target.message_id = message.message_id; // Preserve original message_id for context

        const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
        try {
            const photoUrl = await getPhotoUrl(target);
            const memeImagePath = await addTextToImage(photoUrl, upperText, lowerText, uniqueId);
            
            if (fs.existsSync(memeImagePath)) {
                const sent = await sendPhoto(message, memeImagePath);
                if (sent) {
                    // Remove the file after sending it, if it was a temp file we created
                    if (memeImagePath.startsWith('/tmp/') || memeImagePath.startsWith(path.resolve('/tmp'))) {
                        fs.unlink(memeImagePath, (err) => {
                            if (err) {
                                console.error(`Error deleting file: ${memeImagePath}`, err);
                            } else {
                                console.log(`Successfully deleted file: ${memeImagePath}`);
                            }
                        });
                    }
                }
            } else {
                console.error('Generated meme image does not exist:', memeImagePath);
                react(message, "⚠️"); // Error reaction
            }
        } catch (error) {
            console.error('Error processing meme:', error);
            react(message, "😵");
        }
    } else if (!target || !target.photo) {
        react(message, "🖼️"); // React if no photo is replied to
    } else {
        react(message, "🤔"); // React if no text is provided
    }
}

// Export the main function
module.exports = {
    meme
};

// Example usage (for testing locally, uncomment and adapt)
async function testMeme() {
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
    // Use the absolute path you provided
    const imagePath = '/Users/lifehaver/make/stationthisdeluxebot/watermarks/poundhound.jpg'; 
    const upper = "holy";
    const lower = "moly";
    try {
        console.log(`Starting meme generation with: ${imagePath}`);
        const resultPath = await addTextToImage(imagePath, upper, lower, uniqueId);
        console.log(`Generated meme: ${resultPath}`);
        // Clean up the test file if it was created in /tmp/
        if (resultPath && (resultPath.startsWith('/tmp/') || resultPath.startsWith(path.resolve('/tmp')))) {
            // fs.unlinkSync(resultPath); // Let's not delete immediately for manual inspection
            console.log(`Test file saved at: ${resultPath}. Please delete manually if needed.`);
        }
    } catch (error) {
        console.error('Test meme generation failed:', error);
    }
}

// Run testMeme if the script is executed directly
if (require.main === module) {
    testMeme();
} 