// Import necessary libraries
const Jimp = require('jimp');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Default settings for deep fry image processing
 * These can be overridden by passing custom settings to the image processor
 */
const DEFAULT_SETTINGS = {
    brightness: 0.2,
    contrast: 0.8,
    sharpen: 192,
    saturation: 0,
    noise: 18,
    jpegRepetitions: 6,
    jpegQuality: 0.5,
    tempDir: '/tmp', // Configurable temp directory
    watermarkPath: './watermarks/watermark_new.png'
};

/**
 * Image Post-Processing Service
 * Handles various image effects and transformations
 */
class FryImageProcessor {
    /**
     * Create a new image processor
     * @param {Object} options - Configuration options
     * @param {Object} options.settings - Processing settings
     * @param {Function} options.logger - Logger function (console.log by default)
     */
    constructor(options = {}) {
        this.settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}) };
        this.logger = options.logger || console;
    }

    /**
     * Apply watermark to an image
     * @param {Jimp} img - Jimp image object
     * @param {string} watermarkPath - Path to watermark image
     * @param {string} uniqueId - Unique identifier for the operation
     * @returns {Promise<Canvas>} - Canvas with watermarked image
     */
    async applyWatermark(img, watermarkPath, uniqueId) {
        try {
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
        } catch (error) {
            this.logger.error('Error applying watermark:', error);
            throw new Error(`Failed to apply watermark: ${error.message}`);
        }
    }

    /**
     * Apply deep fry effects to an image
     * @param {Jimp} image - Jimp image object
     * @param {string} uniqueId - Unique identifier for the operation
     * @returns {Promise<Jimp>} - Processed image
     */
    async applyDeepfryEffect(image, uniqueId) {
        try {
            image = image.brightness(this.settings.brightness);
            image = image.contrast(this.settings.contrast);

            // Manually add noise effect
            image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
                const rand = Math.random() * this.settings.noise - this.settings.noise / 2;
                image.bitmap.data[idx] = Math.min(255, Math.max(0, image.bitmap.data[idx] + rand)); // Red
                image.bitmap.data[idx + 1] = Math.min(255, Math.max(0, image.bitmap.data[idx + 1] + rand)); // Green
                image.bitmap.data[idx + 2] = Math.min(255, Math.max(0, image.bitmap.data[idx + 2] + rand)); // Blue
            });

            const tempDeepfriedPath = path.join(this.settings.tempDir, `temp_deepfried_${uniqueId}.jpg`);
            await image.writeAsync(tempDeepfriedPath);
            try {
                return await Jimp.read(tempDeepfriedPath);
            } finally {
                // Clean up temporary file
                this.cleanupTempFile(tempDeepfriedPath);
            }
        } catch (error) {
            this.logger.error('Error applying deep fry effect:', error);
            throw new Error(`Failed to apply deep fry effect: ${error.message}`);
        }
    }

    /**
     * Apply JPEG compression repeatedly
     * @param {Jimp} image - Jimp image object
     * @param {string} uniqueId - Unique identifier for the operation
     * @returns {Promise<Jimp>} - Compressed image
     */
    async applyJPEGCompression(image, uniqueId) {
        try {
            const tempCompressedPath = path.join(this.settings.tempDir, `temp_compressed_${uniqueId}.jpg`);
            
            for (let i = 0; i < this.settings.jpegRepetitions; i++) {
                await image.quality(this.settings.jpegQuality * 100).writeAsync(tempCompressedPath);
                try {
                    image = await Jimp.read(tempCompressedPath);
                } catch (error) {
                    this.logger.error(`Error reading compressed image on iteration ${i}:`, error);
                    throw new Error(`Failed to read compressed image: ${error.message}`);
                }
            }
            
            // Clean up after we're done
            this.cleanupTempFile(tempCompressedPath);
            
            return image;
        } catch (error) {
            this.logger.error('Error applying JPEG compression:', error);
            throw new Error(`Failed to apply JPEG compression: ${error.message}`);
        }
    }

    /**
     * Clean up a temporary file
     * @param {string} filePath - Path to file to clean up
     */
    cleanupTempFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            this.logger.warn(`Failed to clean up temp file ${filePath}:`, error);
        }
    }

    /**
     * Process an image with deep fry effects
     * @param {string} imagePath - Path or URL to image
     * @param {Object} options - Processing options
     * @param {boolean} options.applyWatermark - Whether to apply watermark
     * @param {string} options.watermarkPath - Custom watermark path
     * @param {string} options.outputDirectory - Custom output directory
     * @returns {Promise<string>} - Path to processed image
     */
    async processImage(imagePath, options = {}) {
        const uniqueId = Date.now() + '_' + Math.floor(Math.random() * 10000);
        const watermarkPath = options.watermarkPath || this.settings.watermarkPath;
        const outputDir = options.outputDirectory || this.settings.tempDir;
        const shouldWatermark = options.applyWatermark !== false; // Default to true
        
        const tempFiles = [];
        
        try {
            let img;

            // Check if imagePath is a URL
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                this.logger.info(`Loading image from URL: ${imagePath}`);
                const response = await fetch(imagePath);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                img = await Jimp.read(buffer);
            } else {
                this.logger.info(`Loading image from file: ${imagePath}`);
                img = await Jimp.read(imagePath);
            }

            // Apply watermark if enabled
            if (shouldWatermark) {
                const canvas = await this.applyWatermark(img, watermarkPath, uniqueId);
                img = await Jimp.read(canvas.toBuffer());
            }
            
            // Apply deep fry effects
            img = await this.applyDeepfryEffect(img, uniqueId);
            
            // Apply JPEG compression
            img = await this.applyJPEGCompression(img, uniqueId);

            // Save the final image
            const outputFilePath = path.resolve(outputDir, `deepfried_${uniqueId}.jpg`);
            await img.writeAsync(outputFilePath);

            // Check if the file was written successfully
            if (fs.existsSync(outputFilePath)) {
                this.logger.info(`Image successfully saved to: ${outputFilePath}`);
                return outputFilePath;
            } else {
                throw new Error('Failed to save the image. File does not exist after writing.');
            }
        } catch (error) {
            this.logger.error('Error processing image:', error);
            
            // Clean up any temp files
            tempFiles.forEach(file => this.cleanupTempFile(file));
            
            throw error;
        }
    }
}

// Create a default instance with standard settings
const defaultProcessor = new FryImageProcessor();

/**
 * Legacy function for backward compatibility
 * Process an image with deep fry effects
 * @param {string} imagePath - Path or URL to image
 * @returns {Promise<string>} - Path to processed image
 */
async function processImage(imagePath) {
    return defaultProcessor.processImage(imagePath);
}

/**
 * Legacy function for backward compatibility
 * Apply deep-fry effect to an image from a Telegram message
 * @param {Object} message - Telegram message object
 * @returns {Promise<void>}
 */
async function cheese(message) {
    console.log('made it into the function');
    
    try {
        // Check required dependencies by accessing them
        // This will throw an error if they don't exist
        if (!message || !message.from) {
            console.error('Invalid message object');
            return;
        }
        
        if(!lobby.hasOwnProperty(message.from.id)){
            await checkIn(message);
        }
        
        const target = message.reply_to_message;
        if(target && target.photo) {
            target.from.id = message.from.id;
            target.message_id = message.message_id;
            
            const url = await getPhotoUrl(target);
            if (!url) {
                console.error('Failed to get photo URL');
                return;
            }
            
            const imagePath = await processImage(url);
            const sent = await sendPhoto(message, imagePath);
            
            if(sent) {
                // Remove the file after sending it
                fs.unlink(imagePath, (err) => {
                    if (err) {
                        console.error(`Error deleting file: ${imagePath}`, err);
                    } else {
                        console.log(`Successfully deleted file: ${imagePath}`);
                    }
                });
            }
        } else {
            react(message, "🤔");
        }
    } catch (error) {
        console.error('Error in cheese function:', error);
        try {
            react(message, "❌");
        } catch (reactError) {
            console.error('Failed to react to message:', reactError);
        }
    }
}

// Export all functions for backward compatibility
// And include the new processor class for new code
module.exports = {
    cheese,
    processImage,
    FryImageProcessor,
    // Expose internal functions for testing purposes only
    __test__: {
        applyWatermark: defaultProcessor.applyWatermark.bind(defaultProcessor),
        applyDeepfryEffect: defaultProcessor.applyDeepfryEffect.bind(defaultProcessor),
        applyJPEGCompression: defaultProcessor.applyJPEGCompression.bind(defaultProcessor),
        processImage: defaultProcessor.processImage.bind(defaultProcessor)
    }
};

// Example usage (uncomment to test the script)
// processImage('input.jpg', 'watermark_new.png');

// Example usage (uncomment to test the script)
//processImage('./watermarks/quickfoot.png', './watermarks/watermark_new.png');
