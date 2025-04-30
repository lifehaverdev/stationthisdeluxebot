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

/**
 * Handles the brandcast command and its workflow
 */
async function handleBrandcast(msg) {
    // Check if command is in reply to a video or contains a video
    const video = msg.reply_to_message?.video || msg.video;
    
    if (!video) {
        return await react(msg, '🤔');
    }

    // Initialize state for this user
    ffmpegState[msg.from.id] = {
        videoFileId: video.file_id,
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
        const videoInfo = await bot.getFile(state.videoFileId);
        const imageInfo = await bot.getFile(image.file_id);
        
        const videoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${videoInfo.file_path}`;
        const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${imageInfo.file_path}`;

        // Process status message
        const statusMsg = await sendMessage(msg, '🎬 Processing your video...');

        // Generate output paths
        const outputVideoPath = `/tmp/output_${Date.now()}.mp4`;
        const outputGifPath = `/tmp/output_${Date.now()}.gif`;

        // Process the video
        await addWatermark({
            inputVideo: videoUrl,
            watermarkImage: imageUrl,
            outputVideo: outputVideoPath,
            mode: state.mode
        });

        // Convert to GIF if requested
        if (state.format === 'gif') {
            await convertToGif(outputVideoPath, outputGifPath);
            // Send the processed GIF
            await sendAnimation(msg, fs.createReadStream(outputGifPath));
            // Cleanup
            fs.unlinkSync(outputGifPath);
        } else {
            // Send the processed video
            await sendVideo(msg, fs.createReadStream(outputVideoPath));
        }

        // Cleanup
        fs.unlinkSync(outputVideoPath);
        delete ffmpegState[userId];
        setUserState(msg, 'IDLE');

        // Update status message
        await editMessage({
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id,
            text: '✅ Processing complete!'
        });

    } catch (error) {
        console.error('Error processing video:', error);
        await sendMessage(msg, '❌ Sorry, there was an error processing your video.');
        delete ffmpegState[userId];
        setUserState(msg, 'IDLE');
    }
}

// Register command and handlers
commandRegistry['/brandcast'] = {
    handler: handleBrandcast,
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
  
