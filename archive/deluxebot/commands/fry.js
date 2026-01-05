// Import necessary libraries
const Jimp = require('jimp');
// NOTE: Legacy implementation previously used node-canvas for watermarking.
// canvas dependency has been removed from runtime builds, so this command is kept for reference only.
const { createCanvas, loadImage } = require('canvas');
const { getPhotoUrl, lobby } = require('../utils/bot/bot')
const { sendPhoto, react } = require('../utils/utils')
const { checkIn } = require('../utils/bot/gatekeep')
const fs = require('fs');
const path = require('path');

// Default settings
const settings = {
    brightness: 0.2,
    contrast: 0.8,
    sharpen: 192,
    saturation: 0,
    noise: 18,
    jpegRepetitions: 6,
    jpegQuality: 0.5
};

// Function to apply watermark to an image
async function applyWatermark(img, watermarkPath, uniqueId) {
    const canvas = createCanvas(img.bitmap.width, img.bitmap.height);
    const ctx = canvas.getContext('2d');

    // Draw the original image
    const base64Data = await img.getBase64Async(Jimp.MIME_PNG);
    const originalImage = await loadImage(base64Data);
    ctx.drawImage(originalImage, 0, 0);

    // Load the watermark image
    const watermark = await loadImage(watermarkPath);

    // Calculate watermark dimensions
    const watermarkWidth = img.bitmap.width;
    const watermarkHeight = watermark.height * (img.bitmap.width / watermark.width);

    // Draw the watermark on the canvas
    ctx.drawImage(watermark, 0, img.bitmap.height - watermarkHeight, watermarkWidth, watermarkHeight);

    return canvas;
}

// Function to apply deepfry effects to an image
async function applyDeepfryEffect(image, uniqueId) {
    image = image.brightness(settings.brightness);
    image = image.contrast(settings.contrast);

    // Manually add noise effect
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
        const rand = Math.random() * settings.noise - settings.noise / 2;
        image.bitmap.data[idx] = Math.min(255, Math.max(0, image.bitmap.data[idx] + rand)); // Red
        image.bitmap.data[idx + 1] = Math.min(255, Math.max(0, image.bitmap.data[idx + 1] + rand)); // Green
        image.bitmap.data[idx + 2] = Math.min(255, Math.max(0, image.bitmap.data[idx + 2] + rand)); // Blue
    });

    const tempDeepfriedPath = `/tmp/temp_deepfried_${uniqueId}.jpg`;
    await image.writeAsync(tempDeepfriedPath);
    return await Jimp.read(tempDeepfriedPath);
}

// Function to apply JPEG compression repeatedly
async function applyJPEGCompression(image, uniqueId) {
    for (let i = 0; i < settings.jpegRepetitions; i++) {
        const tempCompressedPath = `/tmp/temp_compressed_${uniqueId}.jpg`;
        await image.quality(settings.jpegQuality * 100).writeAsync(tempCompressedPath);
        image = await Jimp.read(tempCompressedPath);
    }
    return image;
}

// Main function to process an image
async function processImage(imagePath) {
    const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
    const watermarkPath = './watermarks/watermark_new.png'
    try {
        let img;

        // Check if imagePath is a URL
        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            const response = await fetch(imagePath);
            if (!response.ok) {
                throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            img = await Jimp.read(buffer);
        } else {
            img = await Jimp.read(imagePath);
        }

        let canvas = await applyWatermark(img, watermarkPath, uniqueId);
        img = await Jimp.read(canvas.toBuffer());
        img = await applyDeepfryEffect(img, uniqueId);
        img = await applyJPEGCompression(img, uniqueId);

        // Save the final image
        const outputFilePath = path.resolve('/tmp', `deepfried_${uniqueId}.jpg`);
        await img.writeAsync(outputFilePath);

        // Check if the file was written successfully
        if (fs.existsSync(outputFilePath)) {
            console.log(`Image successfully saved to: ${outputFilePath}`);
        } else {
            console.error('Failed to save the image. File does not exist after writing.');
        }

        return outputFilePath;
    } catch (error) {
        console.error('Error processing image:', error);
        throw error;
    }
}

async function cheese(message) {
    console.log('made it into the function')
    if(!lobby.hasOwnProperty(message.from.id)){
        await checkIn(message)
    }
    const target = message.reply_to_message;
    if(target.photo) {
        target.from.id = message.from.id;
        target.message_id = message.message_id
        const url = await getPhotoUrl(target)
        const send = await processImage(url);
        const sent = await sendPhoto(message,send)
        if(sent) {
            // Remove the file after sending it
            fs.unlink(send, (err) => {
                if (err) {
                    console.error(`Error deleting file: ${send}`, err);
                } else {
                    console.log(`Successfully deleted file: ${send}`);
                }
            });
        }
    } else {
        react(message,"🤔")
    }
}

// Export the main function
module.exports = {
    cheese
};

// Example usage (uncomment to test the script)
// processImage('input.jpg', 'watermark_new.png');

// Example usage (uncomment to test the script)
//processImage('./watermarks/quickfoot.png', './watermarks/watermark_new.png');
