/**
 * StationThis Simple Bot
 * 
 * A simplified version of the bot that initializes just the essential components.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

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
if (!botToken) {
  console.error('❌ ERROR: TELEGRAM_TOKEN environment variable is not set');
  process.exit(1);
}

try {
  const bot = new TelegramBot(botToken, { polling: true });
  logger.info('Telegram bot instance created');
  console.log('✅ Telegram bot instance created successfully');
  
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
🛠 Visit the dashboard at http://localhost:3001 for more details
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
  
  // Simple web dashboard
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>StationThis Bot Dashboard</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 1rem;
            }
            header {
              background: #5865F2;
              color: white;
              padding: 1rem;
              border-radius: 0.5rem;
              margin-bottom: 2rem;
              text-align: center;
            }
            .card {
              background: white;
              border-radius: 0.5rem;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
              padding: 1.5rem;
              margin-bottom: 1.5rem;
            }
            .status {
              display: flex;
              align-items: center;
              margin-bottom: 0.5rem;
            }
            .status-indicator {
              width: 12px;
              height: 12px;
              border-radius: 50%;
              margin-right: 0.75rem;
            }
            .status-active {
              background-color: #43B581;
            }
          </style>
        </head>
        <body>
          <header>
            <h1>StationThis Simple Bot</h1>
            <p>Bot Status Dashboard</p>
          </header>
          
          <div class="card">
            <h2>System Status</h2>
            <div class="status">
              <div class="status-indicator status-active"></div>
              <span>System Active - Uptime: <span id="uptime">calculating...</span></span>
            </div>
            <div class="status">
              <div class="status-indicator status-active"></div>
              <span>Telegram Bot: Connected</span>
            </div>
          </div>
          
          <div class="card">
            <h2>Bot Commands</h2>
            <ul>
              <li><code>/ping</code> - Check if the bot is online</li>
              <li><code>/status</code> - View bot status</li>
              <li><code>/make [prompt]</code> - Generate an AI image</li>
              <li><code>/help</code> - Show help message</li>
            </ul>
          </div>
          
          <div class="card">
            <h2>Quick Links</h2>
            <p><a href="/api/health">Health Check API</a></p>
            <p><a href="/api/status">Status API</a></p>
          </div>
          
          <script>
            // Update uptime in real-time
            function updateUptime() {
              fetch('/api/health')
                .then(response => response.json())
                .then(data => {
                  const uptime = Math.floor(data.uptime);
                  const hours = Math.floor(uptime / 3600);
                  const minutes = Math.floor((uptime % 3600) / 60);
                  const seconds = uptime % 60;
                  
                  document.getElementById('uptime').textContent = 
                    \`\${hours}h \${minutes}m \${seconds}s\`;
                })
                .catch(error => console.error('Error fetching uptime:', error));
            }
            
            // Initial update and set interval
            updateUptime();
            setInterval(updateUptime, 1000);
          </script>
        </body>
      </html>
    `);
  });
  
  console.log('✅ Web routes configured');
  
  // Start server
  const port = process.env.PORT || 3002;
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    console.log(`✅ Server started on port ${port}`);
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