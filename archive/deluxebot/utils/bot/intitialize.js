const { 
    //loraTriggers, 
    burns, rooms, flows } = require('./bot');
const FloorplanDB = require('../../db/models/floorplan');
const BurnsDB = require('../../db/models/burns');
const WorkflowDB = require('../../db/models/workflows');
//const LoraDB = require('../../db/models/loralist');

let busy = false;

// async function readLoraList() {
//     const loraDB = new LoraDB();
//     try {
//         const document = await loraDB.findOne();
//         if (document && document.loraTriggers) {
//             loraTriggers.length = 0; // Clear existing array
//             document.loraTriggers.map(triggerStr => loraTriggers.push(triggerStr));
//         }
//         console.log('loraTriggers loaded');
//     } catch (error) {
//         console.error('Error loading loras:', error);
//     }
// }

async function readBurns() {
    const burnsDB = new BurnsDB();
    try {
        const documents = await burnsDB.findMany();
        const burnsMap = new Map();

        burns.length = 0;
        documents.forEach(doc => {
            const wallet = doc.wallet;
            const burnts = doc.burns;

            if (!burnsMap.has(wallet)) {
                burnsMap.set(wallet, 0);
            }

            burnts.forEach(burn => {
                burnsMap.set(wallet, burnsMap.get(wallet) + burn.amount);
            });
        });

        burnsMap.forEach((burned, wallet) => {
            burns.push({ wallet, burned });
        });
        console.log('burns loaded');
    } catch (error) {
        console.error('Error loading burns:', error);
    }
}

async function readRooms() {
    const floorplanDB = new FloorplanDB();
    try {
        const documents = await floorplanDB.findMany();
        rooms.length = 0;
        documents.forEach(doc => {
            rooms.push(doc);
        });
        console.log('found the rooms');
        rooms.forEach(room => {
            console.log(room.title);
        });
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

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
    const workflowDB = new WorkflowDB();
    try {
        const document = await workflowDB.findOne();
        if (document && document.flows) {
            flows.length = 0;
            document.flows.map(flow => {
                const parsedInputs = parseWorkflow(JSON.parse(flow.layout));
                flows.push({
                    name: flow.name,
                    ids: flow.ids,
                    inputs: parsedInputs
                });
            });
        }
        console.log('workflows loaded');
    } catch (error) {
        console.error('Error getting workflows:', error);
    }
}

async function initialize() {
    busy = true;
    console.log('XXXXXXX ...initializing... XXXXXXX');
    //console.log('getting lora list...');
    //await readLoraList();
    console.log('reading burns...');
    await readBurns();
    console.log('reading rooms...');
    await readRooms();
    console.log('reading workflows...');
    await readWorkflows();
    console.log('!...ready...!');
    busy = false;
}

module.exports = {
    initialize,
    busy
};