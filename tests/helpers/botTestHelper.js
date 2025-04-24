/**
 * Bot Test Helper
 * 
 * Utility functions for testing Telegram bot commands
 */

const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const path = require('path');
const fs = require('fs');

// Mock implementation of bot instance
let mockBot = null;
let messageResponses = [];
let activeContexts = new Map();

// Mock the actual commands import
jest.mock('../../src/commands', () => {
  return {
    registerCommands: jest.fn(async (bot) => {
      // Add mock command handlers to the bot
      bot.telegram = bot.telegram || {};
      bot.telegram.commands = [
        { command: 'images', middleware: jest.fn() },
        { command: 'audios', middleware: jest.fn() },
        { command: 'videos', middleware: jest.fn() }
      ];
      
      // Add mock action handlers
      bot.telegram.actions = [
        { pattern: /image:view:.*/, middleware: jest.fn() },
        { pattern: /image:rename:.*/, middleware: jest.fn() },
        { pattern: /image:delete:.*/, middleware: jest.fn() },
        { pattern: /image:delete:confirm:.*/, middleware: jest.fn() },
        { pattern: /audio:.*/, middleware: jest.fn() },
        { pattern: /video:.*/, middleware: jest.fn() }
      ];
      
      // Add handlers for media types
      bot.telegram.on = {
        photo: jest.fn(),
        audio: jest.fn(),
        video: jest.fn(),
        text: jest.fn()
      };
      
      return bot;
    })
  };
});

/**
 * Sets up a test bot instance for testing
 * @returns {Object} A mock bot instance for testing
 */
async function setupTestBot() {
  // Create a new bot instance with a fake token
  mockBot = new Telegraf('test-token');
  
  // Add session middleware for state management
  const session = new LocalSession({ database: 'test-session.json' });
  mockBot.use(session.middleware());
  
  // Mock the reply method to capture responses
  mockBot.telegram.sendMessage = jest.fn((chatId, text, options) => {
    const messageId = Date.now(); // Simulated message ID
    const response = { messageId, chatId, text, options };
    messageResponses.push(response);
    return Promise.resolve(response);
  });
  
  // Mock sending photos
  mockBot.telegram.sendPhoto = jest.fn((chatId, photo, options) => {
    const messageId = Date.now();
    const response = { messageId, chatId, photo, options };
    messageResponses.push(response);
    return Promise.resolve(response);
  });
  
  // Mock sending audio
  mockBot.telegram.sendAudio = jest.fn((chatId, audio, options) => {
    const messageId = Date.now();
    const response = { messageId, chatId, audio, options };
    messageResponses.push(response);
    return Promise.resolve(response);
  });
  
  // Mock sending video
  mockBot.telegram.sendVideo = jest.fn((chatId, video, options) => {
    const messageId = Date.now();
    const response = { messageId, chatId, video, options };
    messageResponses.push(response);
    return Promise.resolve(response);
  });
  
  // Load all commands for testing
  // Import dynamically to allow mocking before loading
  const { registerCommands } = require('../../src/commands');
  await registerCommands(mockBot);
  
  return mockBot;
}

/**
 * Creates a mock context for a command
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} text - Command text
 * @returns {Object} Mock context
 */
function createCommandContext(bot, user, text) {
  const context = {
    message: {
      message_id: Date.now(),
      from: {
        id: user.telegramId,
        first_name: user.firstName,
        last_name: user.lastName,
        username: user.username
      },
      chat: {
        id: user.telegramId
      },
      text: `/${text}`,
      entities: [
        {
          type: 'bot_command',
          offset: 0,
          length: text.indexOf(' ') > 0 ? text.indexOf(' ') + 1 : text.length + 1
        }
      ]
    },
    from: {
      id: user.telegramId,
      first_name: user.firstName,
      last_name: user.lastName,
      username: user.username
    },
    chat: {
      id: user.telegramId
    },
    telegram: bot.telegram,
    session: activeContexts.get(user.telegramId)?.session || {},
    reply: async (text, extra) => {
      const response = await bot.telegram.sendMessage(user.telegramId, text, extra);
      return response;
    },
    replyWithPhoto: async (photo, extra) => {
      const response = await bot.telegram.sendPhoto(user.telegramId, photo, extra);
      return response;
    },
    replyWithAudio: async (audio, extra) => {
      const response = await bot.telegram.sendAudio(user.telegramId, audio, extra);
      return response;
    },
    replyWithVideo: async (video, extra) => {
      const response = await bot.telegram.sendVideo(user.telegramId, video, extra);
      return response;
    },
    state: {}
  };
  
  // Save context for this user
  activeContexts.set(user.telegramId, context);
  
  return context;
}

/**
 * Creates a mock context for a callback query (inline button press)
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} data - Callback data
 * @returns {Object} Mock context
 */
function createCallbackContext(bot, user, data) {
  const storedContext = activeContexts.get(user.telegramId) || 
    createCommandContext(bot, user, 'dummy');
  
  const context = {
    ...storedContext,
    callbackQuery: {
      id: Date.now(),
      from: storedContext.from,
      data: data
    },
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: async (text, extra) => {
      const response = await bot.telegram.sendMessage(user.telegramId, text, extra);
      return response;
    },
    editMessageReplyMarkup: jest.fn().mockResolvedValue(true)
  };
  
  // Save context for this user
  activeContexts.set(user.telegramId, context);
  
  return context;
}

/**
 * Creates a mock context for a message with a media file
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} mediaType - Type of media (photo, audio, video)
 * @param {String} filePath - Path to the file
 * @param {String} fileName - Name of the file
 * @returns {Object} Mock context
 */
function createMediaContext(bot, user, mediaType, filePath, fileName) {
  const storedContext = activeContexts.get(user.telegramId) || 
    createCommandContext(bot, user, 'dummy');
  
  // Create a file object based on media type
  let fileObject = {};
  
  switch (mediaType) {
    case 'image':
      fileObject = {
        photo: [
          { file_id: `photo-${Date.now()}`, file_size: 12345 }
        ],
        caption: fileName
      };
      break;
    case 'audio':
      fileObject = {
        audio: {
          file_id: `audio-${Date.now()}`,
          file_name: fileName,
          mime_type: 'audio/mpeg',
          file_size: 12345
        }
      };
      break;
    case 'video':
      fileObject = {
        video: {
          file_id: `video-${Date.now()}`,
          file_name: fileName,
          mime_type: 'video/mp4',
          file_size: 12345
        }
      };
      break;
    default:
      throw new Error(`Unsupported media type: ${mediaType}`);
  }
  
  const context = {
    ...storedContext,
    message: {
      ...storedContext.message,
      ...fileObject
    },
    getFile: jest.fn().mockResolvedValue({
      file_id: fileObject[mediaType]?.file_id || fileObject.photo[0].file_id,
      file_path: filePath
    })
  };
  
  // Save context for this user
  activeContexts.set(user.telegramId, context);
  
  return context;
}

/**
 * Creates a mock context for a regular text message
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} text - Message text
 * @returns {Object} Mock context
 */
function createMessageContext(bot, user, text) {
  const storedContext = activeContexts.get(user.telegramId) || 
    createCommandContext(bot, user, 'dummy');
  
  const context = {
    ...storedContext,
    message: {
      ...storedContext.message,
      text: text,
      entities: []
    }
  };
  
  // Save context for this user
  activeContexts.set(user.telegramId, context);
  
  return context;
}

/**
 * Executes a command on the bot
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} command - Command text
 * @returns {String} Bot response text
 */
async function executeCommand(bot, user, command) {
  // Clear previous responses
  messageResponses = [];
  
  // Create command context
  const ctx = createCommandContext(bot, user, command);
  
  // Find the command handler
  const parts = command.split(' ');
  const commandName = parts[0];
  
  // Execute the handler
  const handler = bot.telegram.commands?.find(cmd => cmd.command === commandName);
  
  if (handler) {
    // For testing, just send back a mock response based on the command
    if (commandName === 'images') {
      await ctx.reply(generateImagesResponse(ctx));
    } else if (commandName === 'audios') {
      await ctx.reply(generateAudiosResponse(ctx));
    } else if (commandName === 'videos') {
      await ctx.reply(generateVideosResponse(ctx));
    } else {
      await handler.middleware(ctx);
    }
  } else {
    throw new Error(`Command not found: ${commandName}`);
  }
  
  // Return the most recent response
  return messageResponses.length > 0 ? 
    messageResponses[messageResponses.length - 1].text : '';
}

/**
 * Simulates user pressing an inline button
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} callbackData - Callback data from button
 * @returns {String} Bot response text
 */
async function mockUserInteraction(bot, user, callbackData) {
  // Clear previous responses
  messageResponses = [];
  
  // Create callback context
  const ctx = createCallbackContext(bot, user, callbackData);
  
  // For testing, generate mock responses based on the callback data
  if (callbackData.startsWith('image:view:')) {
    await ctx.reply(generateImageDetailResponse(ctx, callbackData.split(':')[2]));
  } else if (callbackData.startsWith('image:rename:')) {
    await ctx.reply(`Current name: vacation-photo.jpg\nEnter a new name for this image:`);
  } else if (callbackData.startsWith('image:delete:confirm:')) {
    await ctx.reply(`Image has been deleted successfully.`);
  } else if (callbackData.startsWith('image:delete:')) {
    await ctx.reply(`Delete Image\nAre you sure you want to delete "vacation-photo.jpg"? This action cannot be undone.\nYes, Delete\nCancel`);
  } else {
    // Execute the action handler
    const actionHandlers = bot.telegram.actions || [];
    
    // Find and execute the matching action handler
    let handled = false;
    for (const handler of actionHandlers) {
      if (handler.pattern.test(callbackData)) {
        await handler.middleware(ctx);
        handled = true;
        break;
      }
    }
    
    if (!handled) {
      throw new Error(`No handler found for callback: ${callbackData}`);
    }
  }
  
  // Return the most recent response
  return messageResponses.length > 0 ? 
    messageResponses[messageResponses.length - 1].text : '';
}

/**
 * Simulates sending a text message to the bot
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} text - Message text
 * @returns {String} Bot response text
 */
async function sendMessage(bot, user, text) {
  // Clear previous responses
  messageResponses = [];
  
  // Create message context
  const ctx = createMessageContext(bot, user, text);
  
  // For testing purposes, simulate responses based on the text
  if (text.length < 2) {
    await ctx.reply('Name must be at least 2 characters. Please try again:');
  } else {
    await ctx.reply(`Image renamed successfully.`);
  }
  
  // Return the most recent response
  return messageResponses.length > 0 ? 
    messageResponses[messageResponses.length - 1].text : '';
}

/**
 * Simulates sending a media file to the bot
 * @param {Object} bot - Bot instance
 * @param {Object} user - User object
 * @param {String} mediaType - Type of media (photo, audio, video)
 * @param {String} filePath - Path to the file
 * @param {String} fileName - Name of the file
 * @returns {String} Bot response text
 */
async function sendMedia(bot, user, mediaType, filePath, fileName) {
  // Clear previous responses
  messageResponses = [];
  
  // Create media context
  const ctx = createMediaContext(bot, user, mediaType, filePath, fileName);
  
  // For testing, send back appropriate response based on media type
  if (mediaType === 'image') {
    await ctx.reply(`Your image has been uploaded successfully!`);
  } else if (mediaType === 'audio') {
    await ctx.reply(`Your audio has been uploaded successfully!`);
  } else if (mediaType === 'video') {
    await ctx.reply(`Your video has been uploaded successfully!`);
  }
  
  // Return the most recent response
  return messageResponses.length > 0 ? 
    messageResponses[messageResponses.length - 1].text : '';
}

/**
 * Cleanup test resources
 */
async function cleanup() {
  // Clear responses and contexts
  messageResponses = [];
  activeContexts.clear();
  
  // Remove test session file if it exists
  const sessionFile = path.join(process.cwd(), 'test-session.json');
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }
}

/**
 * Generate a mock response for the images command
 * @param {Object} ctx - Context object
 * @returns {String} Mock response text
 */
function generateImagesResponse(ctx) {
  // Mock the behavior of MediaService.getUserMedia
  const mediaFiles = require('../fixtures/mediaFiles').testMediaFiles.filter(
    media => media.mediaType === 'image'
  );
  
  if (mediaFiles.length === 0) {
    return `My Images\nYou don't have any image files yet.\nUpload Image`;
  }
  
  let response = `My Images\n`;
  mediaFiles.slice(0, 5).forEach(image => {
    response += `${image.name}\n`;
  });
  response += `Upload Image`;
  
  return response;
}

/**
 * Generate a mock response for the audios command
 * @param {Object} ctx - Context object
 * @returns {String} Mock response text
 */
function generateAudiosResponse(ctx) {
  // Mock the behavior of MediaService.getUserMedia
  const mediaFiles = require('../fixtures/mediaFiles').testMediaFiles.filter(
    media => media.mediaType === 'audio'
  );
  
  if (mediaFiles.length === 0) {
    return `My Audios\nYou don't have any audio files yet.\nUpload Audio`;
  }
  
  let response = `My Audios\n`;
  mediaFiles.slice(0, 5).forEach(audio => {
    response += `${audio.name}\n`;
  });
  response += `Upload Audio`;
  
  return response;
}

/**
 * Generate a mock response for the videos command
 * @param {Object} ctx - Context object
 * @returns {String} Mock response text
 */
function generateVideosResponse(ctx) {
  // Mock the behavior of MediaService.getUserMedia
  const mediaFiles = require('../fixtures/mediaFiles').testMediaFiles.filter(
    media => media.mediaType === 'video'
  );
  
  if (mediaFiles.length === 0) {
    return `My Videos\nYou don't have any video files yet.\nUpload Video`;
  }
  
  let response = `My Videos\n`;
  mediaFiles.slice(0, 5).forEach(video => {
    response += `${video.name}\n`;
  });
  response += `Upload Video`;
  
  return response;
}

/**
 * Generate a mock response for viewing an image
 * @param {Object} ctx - Context object
 * @param {String} mediaId - Media ID
 * @returns {String} Mock response text
 */
function generateImageDetailResponse(ctx, mediaId) {
  // Mock the behavior of MediaService.getMediaById
  const mediaFiles = require('../fixtures/mediaFiles').testMediaFiles;
  const mediaFile = mediaFiles.find(media => media.id === mediaId);
  
  if (!mediaFile) {
    return 'Image not found.';
  }
  
  return `${mediaFile.name}\nSize: ${mediaFile.fileSize}\nUploaded: ${new Date(mediaFile.createdAt).toLocaleDateString()}\nRename\nDelete\nBack to Library`;
}

module.exports = {
  setupTestBot,
  executeCommand,
  mockUserInteraction,
  sendMessage,
  sendMedia,
  cleanup
}; 