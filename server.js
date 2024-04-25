const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

const token = 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new TelegramBot(token);

const app = express();

// Parse the JSON body of incoming requests
app.use(bodyParser.json());

// Endpoint to handle Telegram updates
app.post(`/webhook/${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server is running on port ${PORT}`);
});