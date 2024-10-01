const { MongoClient } = require("mongodb");
const { loraTriggers, burns , rooms, flows} = require('../bot/bot')
// read mongodb for burns, return object for addresses
async function readBurns() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('burns');

        // Find all documents in the collection
        const documents = await collection.find().toArray();
        // Initialize a map to store the total burned amount for each wallet
        const burnsMap = new Map();

        burns.length = 0;
        // Process each document
        documents.forEach(doc => {
        const wallet = doc.wallet;
        const burnts = doc.burns;

        // Initialize the total amount for this wallet if it doesn't exist
        if (!burnsMap.has(wallet)) {
            burnsMap.set(wallet, 0);
        }

        // Sum up the burned amounts for this wallet
        burnts.forEach(burn => {
            burnsMap.set(wallet, burnsMap.get(wallet) + burn.amount);
        });
        });

        burnsMap.forEach((burned, wallet) => {
            //console.log('wallet',wallet,'burned',burned)
            burns.push({ wallet, burned });
        });

        // // Convert the map to the desired burns array format
        // const burnsArray = Array.from(burnsMap.entries()).map(([wallet, burned]) => ({
        // wallet,
        // burned
        // }));

        // Log the result
        //console.log('Burns:', burns);
        

        console.log('burns loaded');
    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

// read mongodb for loras, return loraTrigger object
async function readLoraList() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('loralist');

        // Find all documents in the collection
        const document = await collection.findOne()
        if (document && document.loraTriggers) {
            // Parse the loraTriggers field and update the existing array
            loraTriggers.length = 0; // Clear the existing array
            //const parsedTriggers = 
            document.loraTriggers.map(triggerStr => loraTriggers.push(triggerStr))//JSON.parse(triggerStr));
            
            //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        }

        console.log('loraTriggers loaded');
        //console.log(JSON.stringify(loraTriggers))
    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function readRooms() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('floorplan');

        // Find all documents in the collection
        // const document = await collection.findOne()
        // console.log('document found',document)
        // if (document && document.rooms) {
        //     // Parse the loraTriggers field and update the existing array
        //     rooms.length = 0; // Clear the existing array
        //     //const parsedTriggers = 
        //     document.rooms.map(room => rooms.push(room))//JSON.parse(triggerStr));
            
        //     //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        // }
        // Find all documents in the collection
        const documents = await collection.find().toArray();
        // Initialize a map to store the total burned amount for each wallet
        rooms.length = 0;
        // Process each document
        documents.forEach(doc => {
            rooms.push(doc)
        })

        console.log('found the rooms')//,rooms)
        rooms.forEach(room => {
            console.log(room.name)
        })


    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}


// Function to classify node types and extract relevant inputs
function classifyNodeType(node) {
    let relevantInputs = [];

    switch (node.type) {
        case 'ComfyUIDeployExternalImage':
            relevantInputs.push('input_image');
            break;
        case 'ComfyUIDeployExternalNumberInt':
            relevantInputs.push('input_seed');
            break;
        case 'ComfyUIDeployExternalNumber':
            relevantInputs.push('input_number');
            break;
        case 'ComfyUIDeployExternalText':
            relevantInputs.push('input_text');
            break;
        case 'ComfyUIDeployExternalCheckpoint':
            relevantInputs.push('input_checkpoint');
            break;
        case 'ComfyUIDeployExternalTextAny':
            relevantInputs.push('input_text_any');
            break;
        default:
            console.log(`Unknown node type: ${node.type}`);
    }

    return relevantInputs;
}

// Parse the workflow JSON and extract desired inputs
function parseWorkflow(workflow) {
    let workflowInputs = [];

    const deployNodes = workflow.nodes.filter(node => node.type.startsWith('ComfyUIDeploy'));

    deployNodes.forEach(node => {
        const inputs = classifyNodeType(node);
        workflowInputs.push(...inputs); // Collect relevant inputs
    });

    return workflowInputs;
}

async function readWorkflows() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('workflows');

        // Find all documents in the collection
        const document = await collection.findOne()
        if (document && document.flows) {
            // Parse the loraTriggers field and update the existing array
            flows.length = 0; // Clear the existing array
            //const parsedTriggers = 
            document.flows.map(flow => {
                // Assuming flow includes a JSON workflow definition
                const parsedInputs = parseWorkflow(flow.layout);
                flows.push({
                    name: flow.name,
                    ids: flow.ids,
                    inputs: parsedInputs  // Only store the relevant inputs
                });
            })//JSON.parse(triggerStr));
            
            //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        }
        console.log('workflows loaded');
        console.log(JSON.stringify(flows))
    } catch (error) {
        console.error('Error getting workflows:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function initialize() {
    console.log('initializing...')
    console.log('getting lora list...');
    await readLoraList();
    console.log('reading burns...');
    await readBurns();
    console.log('reading rooms...')
    await readRooms();
    console.log('reading workflows...')
    await readWorkflows();
    console.log('ready...!')
}

module.exports = {
    initialize
}