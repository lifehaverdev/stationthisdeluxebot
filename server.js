const express = require('express');
const bodyParser = require('body-parser');
const { getBot } = require('./app');
require('dotenv').config();
const { processWaitlist } = require('./utils/bot/queue');

const app = express();
app.use(bodyParser.json());

console.log('running server now');

app.get('api/webhook',() => {
  console.log('yeah we are open for business')
}) 

app.post('/api/webhook', async (req, res) => {
  console.log('Webhook post received');
  
  // Log the entire request body
  console.log('Request body:', req.body);
  
  try {
    const { status, run_id, outputs } = req.body;
    //console.log('Parsed data:', data);
    
    if (!status || !run_id) {
      const error = 'Invalid request: Missing required fields';
      console.error(error);
      res.status(400).json({ error });
      return;
    }
    
    // Log the parsed data
    console.log('Status:', status);
    console.log('Run ID:', run_id);
    console.log('Outputs:', JSON.stringify(outputs));
    
    // Process the waitlist with the webhook data
    await processWaitlist(status, run_id, outputs);
    console.log('Sent for processing');

    res.status(200).json({ message: "success" });
  } catch (err) {
    console.error('Exception occurred:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

