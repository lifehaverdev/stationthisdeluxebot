const express = require('express');
const bodyParser = require('body-parser');
const { getBot } = require('./app');
require('dotenv').config();
const { processWaitlist } = require('./utils/bot/queue');
const { initialize } = require('./utils/bot/intitialize')
const imageRouter = require('./api/index')
//const { createCollectionZip } = require('./db/operations/downloadCollection');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());
app.use('/v1/images', imageRouter);
// Increase timeout for long-running requests
app.use((req, res, next) => {
  res.setTimeout(300000); // 5 minutes
  next();
});
initialize();

console.log('running server now');

app.get('api/webhook',() => {
  console.log('yeah we are open for business')
}) 

app.post('/api/webhook', async (req, res) => {
  //console.log('Webhook post received');
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
    const logPrefix = '~~⚡~~';  // Spark-like

    console.log(`${logPrefix} Run ID: ${run_id} Status: ${status} `);

    //console.log(' Outputs:', JSON.stringify(outputs));
    
    // Process the waitlist with the webhook data
    await processWaitlist(status, run_id, outputs);
    //console.log('Sent for processing');

    res.status(200).json({ message: "success" });
  } catch (err) {
    console.error('Exception occurred:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// app.get('/download/:collectionId', async (req, res) => {
//     try {
//         const collectionId = req.params.collectionId;
//         const collectionPath = path.join(__dirname, 'output', 'testexecs');
//         const zipPath = path.join(__dirname, 'temp', `collection_${collectionId}.zip`);
//         console.log('collectionPath', collectionPath);
//         console.log('zipPath', zipPath);
//         // Create temp directory if it doesn't exist
//         if (!fs.existsSync(path.join(__dirname, 'temp'))) {
//             fs.mkdirSync(path.join(__dirname, 'temp'));
//         }
//         console.log('creating zip file');
//         // Create the zip file
//         await createCollectionZip(collectionPath, zipPath);
//         console.log('zip file created');
//         // Set headers for file download
//         res.setHeader('Content-Type', 'application/zip');
//         res.setHeader('Content-Disposition', `attachment; filename=collection_${collectionId}.zip`);
//         console.log('setting headers');
//         // Stream the file to the response
//         const fileStream = fs.createReadStream(zipPath);
//         console.log('streaming file');
//         fileStream.pipe(res);
//         console.log('file streamed');

//         // Clean up the zip file after sending
//         fileStream.on('end', () => {
//             fs.unlink(zipPath, (err) => {
//                 if (err) console.error('Error cleaning up zip file:', err);
//             });
//         });

//     } catch (error) {
//         console.error('Download error:', error);
//         res.status(500).send('Error creating download');
//     }
// });

// For testing, add a simple download page
// app.get('/download', (req, res) => {
//     res.send(`
//         <html>
//             <body>
//                 <h1>Collection Download Test</h1>
//                 <p>Click the button to download the test collection:</p>
//                 <button onclick="window.location.href='/download/6702415579280'">
//                     Download Collection
//                 </button>
//             </body>
//         </html>
//     `);
// });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

