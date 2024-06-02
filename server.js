const express = require('express');
const bodyParser = require('body-parser');
const { getBot } = require('./app');
require('dotenv').config();
console.log('running server now');
const { processWaitlist } = require('./utils/bot/queue');

const app = express();
app.use(bodyParser.json());

app.get('api/webhook',() => {
  console.log('yeah we are open for business')
}) 

app.post('/api/webhook', async (req, res) => {
  console.log('Webhook post received');
  
  // Log the entire request body
  console.log('Request body:', req.body);
  
  //const { parseWebhookDataSafe } = await import('comfydeploy');
  
  try {
    const data = req.body;
    //console.log('Parsed data:', data);
    
    if (!data || !data.status || !data.run_id) {
      const error = 'Invalid request: Missing required fields';
      console.error(error);
      res.status(400).json({ error });
      return;
    }

    const { status, run_id, outputs } = data;
    
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

