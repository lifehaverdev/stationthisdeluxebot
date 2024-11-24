const { MongoClient } = require("mongodb");
const { loraTriggers, burns , rooms, flows } = require('../bot/bot')
// read mongodb for burns, return object for addresses
let busy = false;
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
        const documents = await collection.find().toArray();
        // Initialize a map to store the total burned amount for each wallet
        rooms.length = 0;
        // Process each document
        documents.forEach(doc => {
            rooms.push(doc)
        })

        console.log('found the rooms')//,rooms)
        rooms.forEach(room => {
            console.log(room.title)
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

    // Filter nodes that start with 'ComfyUIDeploy'
    const deployNodes = workflow.nodes.filter(node => node.type.startsWith('ComfyUIDeploy'));

    deployNodes.forEach(node => {
        if (node.widgets_values && node.widgets_values.length > 0) {
            // Collect relevant inputs from widgets_values
            node.widgets_values.forEach(value => {
                if (typeof value === 'string' && value.startsWith('input_')) {
                    workflowInputs.push(value);
                }
            });
        }
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
                
                const parsedInputs = parseWorkflow(JSON.parse(flow.layout));
                console.log('%%%',flow.name)//,':\n',parsedInputs)
                flows.push({
                    name: flow.name,
                    ids: flow.ids,
                    inputs: parsedInputs  // Only store the relevant inputs
                });
            })//JSON.parse(triggerStr));
            
            //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        }
        console.log('workflows loaded');
        //console.log((flows))
    } catch (error) {
        console.error('Error getting workflows:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

// async function readWorkflows() {
//     // Connection URI
//     const uri = process.env.MONGO_PASS;

//     // Create a new MongoClient
//     const client = new MongoClient(uri);

//     try {
//         // Connect to the MongoDB server
//         await client.connect();
//         const db = client.db(process.env.BOT_NAME);
//         const collection = db.collection('workflows');

//         // Find all documents in the collection
//         const document = await collection.findOne();
//         if (document && document.flows) {
//             flows.length = 0; // Clear the existing array
//             const allInputsSet = new Set(); // To collect all unique input names

//             document.flows.forEach(flow => {
//                 // Parse the workflow layout for inputs
//                 let parsedInputs = parseWorkflow(JSON.parse(flow.layout));

//                 // Add inputs to the set for tracking
//                 parsedInputs.forEach(input => allInputsSet.add(input));

//                 // Add the workflow to the flows array
//                 flows.push({
//                     name: flow.name,
//                     ids: flow.ids,
//                     inputs: parsedInputs  // Store only relevant inputs
//                 });

//                 // Print the workflow details
//                 console.log(`Workflow Name: ${flow.name}`);
//                 console.log(`Workflow IDs: ${JSON.stringify(flow.ids)}`);
//                 console.log(`Inputs: ${parsedInputs.join(', ')}`);
//                 console.log('-----------------------------');
//             });

//             // Print all unique inputs found across workflows
//             console.log('Unique Inputs Found:');
//             allInputsSet.forEach(input => console.log(input));
//         }

//         console.log('Workflows loaded successfully.');
//     } catch (error) {
//         console.error('Error getting workflows:', error);
//     } finally {
//         // Close the connection
//         await client.close();
//     }
// }


async function initialize() {
    busy = true;
    console.log('XXXXXXX ...initializing... XXXXXXX')
    console.log('getting lora list...');
    await readLoraList();
    console.log('reading burns...');
    await readBurns();
    console.log('reading rooms...')
    await readRooms();
    console.log('reading workflows...')
    await readWorkflows();
    console.log('!...ready...!')
    busy = false;
}

module.exports = {
    initialize,
    busy
}