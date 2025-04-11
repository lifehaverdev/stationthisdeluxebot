/**
 * StationThis Simple Bot
 * 
 * A simplified version of the bot that initializes just the essential components.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// Import the web router
const { setupWebRouter } = require('./integrations/web/router');

console.log('🚀 Starting StationThis Simple Bot...');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});

// Simple logger
const logger = {
  info: (message, data) => console.log(`[INFO] ${message}`, data || ''),
  error: (message, data) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || '')
};

logger.info('Initializing StationThis Simple Bot...');

// Create Telegram bot instance
console.log('🤖 Creating Telegram bot instance...');
const botToken = process.env.TELEGRAM_TOKEN;
const skipTelegram = process.env.SKIP_TELEGRAM === 'true';

if (!botToken && !skipTelegram) {
  console.error('❌ ERROR: TELEGRAM_TOKEN environment variable is not set');
  process.exit(1);
} else if (skipTelegram) {
  console.log('⚠️ Telegram integration disabled by SKIP_TELEGRAM flag');
}

try {
  // Create a mock bot if Telegram is skipped
  let bot;
  if (skipTelegram) {
    // Create a mock bot object with the methods we use
    bot = {
      onText: () => {},
      on: () => {},
      sendMessage: () => {},
      sendPhoto: () => {}
    };
    logger.info('Mock Telegram bot created (Telegram integration disabled)');
    console.log('✅ Mock Telegram bot created successfully');
  } else {
    // Create a real Telegram bot
    bot = new TelegramBot(botToken, { polling: true });
    logger.info('Telegram bot instance created');
    console.log('✅ Telegram bot instance created successfully');
  }
  
  // Add simple commands
  console.log('📝 Adding basic command handlers...');
  
  // Ping command
  bot.onText(/\/ping/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🏓 Pong! Bot is up and running.');
    logger.info('Responded to ping command', { 
      userId: msg.from.id, 
      username: msg.from.username,
      chatId
    });
  });
  
  // Help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
🤖 *StationThis Bot Commands*
• /ping - Check if the bot is online
• /status - View bot status
• /make [prompt] - Generate an AI image with your prompt
• /help - Show this help message
    `;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
  
  // Status command
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const statusMessage = `
🤖 *StationThis Bot Status*
✅ *Online* | Uptime: ${hours}h ${minutes}m ${seconds}s
🛠 Visit the dashboard at http://localhost:3002/interface for more details
    `;
    
    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  });
  
  // General message handler
  bot.on('message', (msg) => {
    // Log all messages that aren't commands
    if (!msg.text || !msg.text.startsWith('/')) {
      logger.info('Received message', {
        userId: msg.from.id,
        username: msg.from.username,
        chatId: msg.chat.id,
        text: msg.text
      });
    }
  });
  
  // Make command - simulate image generation
  bot.onText(/\/make(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const prompt = match[1] ? match[1].trim() : '';
    
    if (!prompt) {
      bot.sendMessage(chatId, "Please provide a prompt after /make. For example: /make a beautiful sunset");
      return;
    }
    
    // Send initial message
    bot.sendMessage(chatId, `🖼 Starting generation for: "${prompt}"...`);
    
    // Simulate processing delay
    setTimeout(() => {
      bot.sendMessage(chatId, "⏳ Processing your request...");
      
      // Simulate image generation (3-5 seconds)
      setTimeout(() => {
        // Get a random placeholder image from picsum
        const width = 512;
        const height = 512;
        const imageId = Math.floor(Math.random() * 1000);
        const imageUrl = `https://picsum.photos/seed/${imageId}/${width}/${height}`;
        
        // Send the "generated" image
        bot.sendPhoto(chatId, imageUrl, {
          caption: `🎨 Generated image for prompt: "${prompt}"`
        });
        
        logger.info('Image generated', {
          userId: msg.from.id,
          username: msg.from.username,
          chatId,
          prompt
        });
      }, 3000 + Math.random() * 2000);
    }, 1000);
  });
  
  console.log('✅ Basic command handlers added');
  
  // API routes
  console.log('🌐 Setting up API routes...');
  
  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  });
  
  // Status endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: process.env.VERSION || '1.0.0',
      components: {
        bot: !!bot
      }
    });
  });
  
  // Mount the web interface
  console.log('  ↳ Setting up web interface...');
  const webRouter = setupWebRouter({ app });
  app.use('/interface', webRouter);
  logger.info('Web interface mounted at /interface');
  console.log('  ✓ Web interface mounted');

  // Redirect root to interface
  app.get('/', (req, res) => {
    res.redirect('/interface');
  });
  
  console.log('✅ Web routes configured');
  
  // Start server
  const port = process.env.PORT || 3002;
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    console.log(`✅ Server started on port ${port}`);
    console.log(`🌎 Web interface available at http://localhost:${port}/interface`);
    console.log('🎉 StationThis Simple Bot is ready!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  // Handle errors
  process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
    logger.error('Uncaught exception', { error });
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
    logger.error('Unhandled rejection', { reason });
  });

} catch (error) {
  console.error('❌ STARTUP ERROR:', error);
  logger.error('Error starting bot', { error });
  process.exit(1);
} 