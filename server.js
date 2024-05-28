const express = require('express');
const bodyParser = require('body-parser');
const { getBot } = require('./app')
require('dotenv').config();
console.log('running server now');
const app = express();
const bot = getBot();

app.use(bodyParser.json());

// Endpoint to receive updates forwarded by the webhook
app.post('/receive-update', (req, res) => {
  const update = req.body;
  bot.processUpdate(update);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot server is running on port ${PORT}`);
});
