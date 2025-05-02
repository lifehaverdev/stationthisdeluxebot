const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { commandRegistry, STATES, stateHandlers, actionMap } = require('../utils/bot/bot');
const { sendMessage, react, sendVideo, sendAnimation, safeExecute, sendWithRetry, setUserState, editMessage } = require('../utils/utils');
const { getBotInstance } = require('../utils/bot/bot');
const bot = getBotInstance();

// Global state for ffmpeg operations
const ffmpegState = {};

// Add FFMPEG to STATES
STATES.FFMPEG = 'FFMPEG';

// Register the state handler
stateHandlers[STATES.FFMPEG] = (message) => safeExecute(message, handleFFMPEGState);

// Shared queue system at the top of the file
const processingQueue = [];
let isProcessing = false;
const MAX_VIDEO_DURATION = 60; // maximum video length in seconds
const MAX_PROCESSING_TIME = 60000; // timeout after 60 seconds (in milliseconds)

// Add to the top with other constants
const ACCEPTED_TYPES = ['video', 'animation']; // animation is Telegram's type for GIF

// Helper function to process the queue
async function processQueue() {
    if (isProcessing || processingQueue.length === 0) return;
    
    isProcessing = true;
    const task = processingQueue.shift();
    
    try {
        await task();
    } catch (error) {
        console.error('Queue processing error:', error);
    } finally {
        isProcessing = false;
        processQueue(); // Process next item in queue
    }
}

// Helper function to add task to queue and send queue position message
async function addToVideoQueue(msg, processingPromise) {
    const queuePosition = processingQueue.length + (isProcessing ? 1 : 0);
    const queueMessage = queuePosition > 0 
        ? `\n⏳ You are #${queuePosition} in the queue.`
        : '';
    
    await sendMessage(msg, '🎬 Video received!' + queueMessage);
    processingQueue.push(processingPromise);
    processQueue();
}

// Helper function to get the media file from the message
function getMediaFile(msg) {
    // Check reply first
    if (msg.reply_to_message) {
        for (const type of ACCEPTED_TYPES) {
            if (msg.reply_to_message[type]) {
                return {
                    file: msg.reply_to_message[type],
                    type: type
                };
            }
        }
    }
    
    // Check original message
    for (const type of ACCEPTED_TYPES) {
        if (msg[type]) {
            return {
                file: msg[type],
                type: type
            };
        }
    }
    
    return null;
}

// Update the duration check function
function isMediaTooLong(media) {
    // GIFs don't always have duration, use a default if missing
    const duration = media.duration || 0;
    return duration > MAX_VIDEO_DURATION;
}

/**
 * Inspect the resolution of a video or image file.
 */
function getResolution(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const stream = metadata.streams.find(s => s.width && s.height);
      if (!stream) return reject(new Error('No resolution found'));
      resolve({ width: stream.width, height: stream.height });
    });
  });
}

/**
 * Adds a watermark or full overlay to a video.
 * @param {Object} options
 * @param {string} options.inputVideo
 * @param {string} options.watermarkImage
 * @param {string} options.outputVideo
 * @param {'overlay'|'watermark'} [options.mode='watermark']
 */
async function addWatermark({ inputVideo, watermarkImage, outputVideo, mode = 'watermark' }) {
  const videoRes = await getResolution(inputVideo);
  const imageRes = await getResolution(watermarkImage);

  const isOverlay = mode === 'overlay';
  const filters = [];

  if (isOverlay) {
    // Full overlay: scale image to match video resolution
    filters.push(
      `[1:v]scale=${videoRes.width}:${videoRes.height}[wm]`,
      `[0:v][wm]overlay=0:0`
    );
  } else {
    // Watermark: scale image to ~20% of video width
    filters.push(
      '[1:v]scale=iw*0.2:-1[wm]',
      '[0:v][wm]overlay=W-w-20:H-h-20'
    );
  }

  return new Promise((resolve, reject) => {
    ffmpeg(inputVideo)
      .input(watermarkImage)
      .complexFilter(filters)
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'veryfast',
        '-movflags', '+faststart'
      ])
      .on('end', () => {
        console.log(`✅ Output saved: ${outputVideo}`);
        resolve(outputVideo);
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg error:', err.message);
        reject(err);
      })
      .save(outputVideo);
  });
}


/**
 * Converts a .mp4 video to an optimized .gif using 2-pass palettegen.
 * @param {string} inputMp4Path - Path to watermarked .mp4 file.
 * @param {string} outputGifPath - Desired .gif path.
 */
function convertToGif(inputMp4Path, outputGifPath) {
    const tmpPalette = outputGifPath.replace(/\.gif$/, '_palette.png');
  
    return new Promise((resolve, reject) => {
      // Step 1: Generate color palette
      ffmpeg(inputMp4Path)
        .outputOptions('-vf', 'palettegen', '-y')
        .output(tmpPalette)
        .on('end', () => {
          // Step 2: Use palette to make high-quality gif
          ffmpeg(inputMp4Path)
            .input(tmpPalette)
            .outputOptions('-filter_complex', 'paletteuse', '-y')
            .output(outputGifPath)
            .on('end', () => {
              fs.unlinkSync(tmpPalette);
              console.log(`🎉 GIF saved to ${outputGifPath}`);
              resolve(outputGifPath);
            })
            .on('error', (err) => {
              console.error('❌ Error during GIF creation:', err.message);
              reject(err);
            })
            .run();
        })
        .on('error', (err) => {
          console.error('❌ Error during palette generation:', err.message);
          reject(err);
        })
        .run();
    });
  }

// Helper function to send the processed media
async function sendProcessedMedia(msg, filePath, originalType) {
    if (originalType === 'animation') {
        return await sendAnimation(msg, fs.createReadStream(filePath));
    }
    return await sendVideo(msg, fs.createReadStream(filePath));
}

/**
 * Handles the brandcast command and its workflow
 */
async function handleBrandcast(msg) {
    const mediaFile = getMediaFile(msg);
    
    if (!mediaFile) {
        return await react(msg, '🤔');
    }

    if (isMediaTooLong(mediaFile.file)) {
        return await sendMessage(msg, `❌ Media is too long! Please send content shorter than ${MAX_VIDEO_DURATION} seconds.`);
    }

    // Initialize state for this user
    ffmpegState[msg.from.id] = {
        mediaFileId: mediaFile.file.file_id,
        inputType: mediaFile.type,  // Track if it's 'video' or 'animation'
        awaitingImage: false
    };

    // Create menu for overlay/watermark choice
    const menu = {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Overlay', callback_data: 'ffmpeg_overlay' },
                { text: 'Watermark', callback_data: 'ffmpeg_watermark' }
            ]]
        }
    };

    await sendMessage(msg, 'How would you like to brand your video?', menu);
}

/**
 * Handles the callback queries for brandcast options
 */
async function handleBrandcastCallback(action, msg) {
    const userId = msg.from.id;
    const mode = action === 'ffmpeg_overlay' ? 'overlay' : 'watermark';
    
    ffmpegState[userId] = {
        ...ffmpegState[userId],
        mode: mode,
        awaitingFormat: true // Add this flag to track the format choice state
    };

    // Create menu for format choice
    const menu = {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Video', callback_data: 'ffmpeg_video' },
                { text: 'GIF', callback_data: 'ffmpeg_gif' }
            ]]
        }
    };

    await editMessage({
        chat_id: msg.message.chat.id,
        message_id: msg.message.message_id,
        text: 'Would you like the output as a video or GIF?',
        reply_markup: menu.reply_markup
    });
}

/**
 * Handles the format choice callback
 */
async function handleFormatChoice(format, msg) {
    const userId = msg.from.id;
    
    ffmpegState[userId] = {
        ...ffmpegState[userId],
        format: format,
        awaitingFormat: false,
        awaitingImage: true
    };

    await editMessage({
        chat_id: msg.message.chat.id,
        message_id: msg.message.message_id,
        text: 'Please send me the image you want to use.'
    });

    // Set user state to await image
    setUserState(msg, 'FFMPEG');
}

/**
 * Handles the image processing state
 */
async function handleFFMPEGState(msg) {
    const userId = msg.from.id;
    const state = ffmpegState[userId];

    if (!state?.awaitingImage) {
        return;
    }

    const image = msg.photo?.[msg.photo.length - 1] || msg.document;
    if (!image) {
        return await react(msg, '❌');
    }

    try {
        // Get file paths
        const mediaInfo = await bot.getFile(state.mediaFileId);
        const imageInfo = await bot.getFile(image.file_id);
        
        const mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${mediaInfo.file_path}`;
        const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${imageInfo.file_path}`;

        // Process status message
        const statusMsg = await sendMessage(msg, '🎬 Processing your media...');

        // Generate output paths
        const outputVideoPath = `/tmp/output_${Date.now()}.mp4`;
        const outputGifPath = `/tmp/output_${Date.now()}.gif`;

        // Add to processing queue
        const processingPromise = async () => {
            try {
                // Process the media
                await addWatermark({
                    inputVideo: mediaUrl,
                    watermarkImage: imageUrl,
                    outputVideo: outputVideoPath,
                    mode: state.mode
                });

                // Handle output format
                if (state.format === 'gif' || state.inputType === 'animation') {
                    await convertToGif(outputVideoPath, outputGifPath);
                    await sendAnimation(msg, fs.createReadStream(outputGifPath));
                    fs.unlinkSync(outputGifPath);
                } else {
                    await sendVideo(msg, fs.createReadStream(outputVideoPath));
                }

                // Cleanup
                fs.unlinkSync(outputVideoPath);
                delete ffmpegState[userId];
                setUserState(msg, 'IDLE');

                await editMessage({
                    chat_id: statusMsg.chat.id,
                    message_id: statusMsg.message_id,
                    text: '✅ Processing complete!'
                });
            } catch (error) {
                console.error('Error processing media:', error);
                await sendMessage(msg, '❌ Sorry, there was an error processing your media.');
                delete ffmpegState[userId];
                setUserState(msg, 'IDLE');
            }
        };

        await addToVideoQueue(msg, processingPromise);

    } catch (error) {
        console.error('Error setting up processing:', error);
        await sendMessage(msg, '❌ Sorry, there was an error processing your media.');
        delete ffmpegState[userId];
        setUserState(msg, 'IDLE');
    }
}

// Register command and handlers
commandRegistry['/brandcast'] = {
    handler: handleBrandcast,
};

commandRegistry['/cultthat'] = {
    handler: async (msg) => {
        const mediaFile = getMediaFile(msg);
        
        if (!mediaFile) {
            return await react(msg, '🤔');
        }

        if (isMediaTooLong(mediaFile.file)) {
            return await sendMessage(msg, `❌ Media is too long! Please send content shorter than ${MAX_VIDEO_DURATION} seconds.`);
        }

        const processingPromise = async () => {
            const statusMsg = await sendMessage(msg, '🔥 Deep frying and culting your media...');
            
            try {
                await Promise.race([
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Processing timeout')), MAX_PROCESSING_TIME)),
                    (async () => {
                        const fileInfo = await bot.getFile(mediaFile.file.file_id);
                        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
                        const watermarkPath = path.join(__dirname, '..', 'watermarks', 'cultoverlay.png');
                        const friedPath = `/tmp/fried_${Date.now()}.mp4`;
                        const outputPath = `/tmp/output_${Date.now()}.mp4`;

                        // Fry the media
                        await new Promise((resolve, reject) => {
                            ffmpeg(fileUrl)
                                .videoFilters([
                                    'eq=saturation=1.5',
                                    'eq=contrast=1.5',
                                    'noise=alls=20:allf=t',
                                    'unsharp=5:5:1.5:5:5:0.0',
                                    {
                                        filter: 'scale',
                                        options: {
                                            w: 'iw/2',
                                            h: 'ih/2'
                                        }
                                    },
                                    {
                                        filter: 'scale',
                                        options: {
                                            w: 'iw*2',
                                            h: 'ih*2'
                                        }
                                    }
                                ])
                                .videoBitrate('500k')
                                .fps(24)
                                // Force format to mp4 for consistency
                                .format('mp4')
                                .save(friedPath)
                                .on('end', resolve)
                                .on('error', reject);
                        });

                        // Add the cult overlay
                        await addWatermark({
                            inputVideo: friedPath,
                            watermarkImage: watermarkPath,
                            outputVideo: outputPath,
                            mode: 'overlay'
                        });

                        // Send as the original type
                        await sendProcessedMedia(msg, outputPath, mediaFile.type);

                        // Cleanup
                        fs.unlinkSync(friedPath);
                        fs.unlinkSync(outputPath);
                        
                        await editMessage({
                            chat_id: statusMsg.chat.id,
                            message_id: statusMsg.message_id,
                            text: '✅ Your media has been fried and culted! 🔥'
                        });
                    })()
                ]);

            } catch (error) {
                console.error('Error processing media:', error);
                const errorMessage = error.message === 'Processing timeout'
                    ? '⏱️ Processing took too long. Please try with shorter media.'
                    : '❌ Sorry, there was an error processing your media.';
                
                await editMessage({
                    chat_id: statusMsg.chat.id,
                    message_id: statusMsg.message_id,
                    text: errorMessage
                });
            }
        };

        await addToVideoQueue(msg, processingPromise);
    }
};

commandRegistry['/frythat'] = {
    handler: async (msg) => {
        const mediaFile = getMediaFile(msg);
        
        if (!mediaFile) {
            return await react(msg, '🤔');
        }

        if (isMediaTooLong(mediaFile.file)) {
            return await sendMessage(msg, `❌ Media is too long! Please send content shorter than ${MAX_VIDEO_DURATION} seconds.`);
        }

        const processingPromise = async () => {
            const statusMsg = await sendMessage(msg, '🔥 Deep frying your media...');
            
            try {
                await Promise.race([
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Processing timeout')), MAX_PROCESSING_TIME)),
                    (async () => {
                        const fileInfo = await bot.getFile(mediaFile.file.file_id);
                        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
                        const outputPath = `/tmp/fried_${Date.now()}.mp4`;

                        await new Promise((resolve, reject) => {
                            ffmpeg(fileUrl)
                                .videoFilters([
                                    'eq=saturation=1.5',
                                    'eq=contrast=1.5',
                                    'noise=alls=20:allf=t',
                                    'unsharp=5:5:1.5:5:5:0.0',
                                    {
                                        filter: 'scale',
                                        options: {
                                            w: 'iw/2',
                                            h: 'ih/2'
                                        }
                                    },
                                    {
                                        filter: 'scale',
                                        options: {
                                            w: 'iw*2',
                                            h: 'ih*2'
                                        }
                                    }
                                ])
                                .videoBitrate('500k')
                                .fps(24)
                                .format('mp4')
                                .save(outputPath)
                                .on('end', resolve)
                                .on('error', reject);
                        });

                        await sendProcessedMedia(msg, outputPath, mediaFile.type);
                        fs.unlinkSync(outputPath);
                        
                        await editMessage({
                            chat_id: statusMsg.chat.id,
                            message_id: statusMsg.message_id,
                            text: '✅ Your media has been thoroughly fried! 🔥'
                        });
                    })()
                ]);

            } catch (error) {
                console.error('Error processing media:', error);
                const errorMessage = error.message === 'Processing timeout'
                    ? '⏱️ Processing took too long. Please try with shorter media.'
                    : '❌ Sorry, there was an error processing your media.';
                
                await editMessage({
                    chat_id: statusMsg.chat.id,
                    message_id: statusMsg.message_id,
                    text: errorMessage
                });
            }
        };

        await addToVideoQueue(msg, processingPromise);
    }
};

// Add action handlers for overlay and watermark callbacks
actionMap['ffmpeg_overlay'] = async (message, user) => {
    return await handleBrandcastCallback('ffmpeg_overlay', {
        from: { id: user },
        message: message,
        chat: message.chat
    });
};

actionMap['ffmpeg_watermark'] = async (message, user) => {
    return await handleBrandcastCallback('ffmpeg_watermark', {
        from: { id: user },
        message: message,
        chat: message.chat
    });
};

// Add new handlers for format choice
actionMap['ffmpeg_video'] = async (message, user) => {
    return await handleFormatChoice('video', {
        from: { id: user },
        message: message,
        chat: message.chat
    });
};

actionMap['ffmpeg_gif'] = async (message, user) => {
    return await handleFormatChoice('gif', {
        from: { id: user },
        message: message,
        chat: message.chat
    });
};

module.exports = {
    addWatermark,
    getResolution,
    convertToGif,
    handleBrandcast,
    handleBrandcastCallback,
    handleFFMPEGState
};

// 🧪 Run from CLI
if (require.main === module) {
    (async () => {
      try {
        const inputVideo = '/Users/lifehaver/ai/stationthisimg2vid_00001.mp4';
        const watermarkImage = '/Users/lifehaver/make/stationthisdeluxebot/watermarks/ms2disc.png';
        const outputVideo = inputVideo.replace(/\.mp4$/, '_out.mp4');
        const outputGif = inputVideo.replace(/\.mp4$/, '_out.gif');
  
        await addWatermark({
          inputVideo,
          watermarkImage,
          outputVideo,
          mode: 'overlay', //or 'watermark'
        });
  
        await convertToGif(outputVideo, outputGif);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    })();
  }
  
