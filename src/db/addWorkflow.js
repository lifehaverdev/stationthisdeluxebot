const { MongoClient } = require('mongodb');
require('dotenv').config();

// Command line arguments
const [WORKFLOWNAME, WORKFLOWID] = process.argv.slice(2);

if (!WORKFLOWNAME || !WORKFLOWID) {
    console.error('Please provide both arguments: WORKFLOWNAME, WORKFLOWID');
    process.exit(1);
}

async function addWorkflow(workflowName, workflowId) {
    const uri = process.env.MONGO_PASS; // Ensure you have your MongoDB URI in your .env file
    const dbName = process.env.BOT_NAME || 'stationthisbot'; // Replace with your actual database name
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const collection = client.db(dbName).collection('workflows');

        // Construct the new workflow object
        const newWorkflow = {
            name: workflowName,
            ids: ['', workflowId] // Skipping the first item, adding workflowId to the second
        };

        // Update the document by pushing the new workflow object into the array
        await collection.updateOne(
            {}, // Assuming there's only one document in the collection
            { $push: { flows: newWorkflow } } // Adjust 'workflowArray' to match the actual field name
        );

        console.log('Workflow added successfully');
    } catch (error) {
        console.error("Error adding workflow:", error);
    } finally {
        await client.close();
    }
}

// Call the function with command line arguments
addWorkflow(WORKFLOWNAME, WORKFLOWID);
