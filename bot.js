const TelegramBot = require("node-telegram-bot-api");
const Jimp = require('jimp');
const fs = require("fs");

const path = require('path');
const { getBalance } = require ('./utils/checkBalance')
const { generateImage, fetchWorkflowOutput } = require('./commands/make.js')
const { generateImage2Image } = require('./commands/ms2.js')
const { generateImg2Vid } = require('./commands/ms3.js')
const { interrogateImage } = require('./commands/interrogate.js')
const { getUserData, writeUserData } = require('./utils/checkUser.js')
const { checkBlacklist } = require('./utils/checkBlacklist.js');
const { generateMasterKey, resetAccountsToDefault } = require('./utils/accountManagement.js')
const { writeToDisc } = require('./utils/waterMark.js');
const defaultUserData = require("./utils/defaultUserData.js");
const basepromptmenu = require("./utils/basepromptmenu.js");
require("dotenv").config()

resetAccountsToDefault()
//generateMasterKey()

// Call the function to send reset messages to all chats

let startup = Date.now()

const ignoreQueue = process.argv[2] === 'true';
const MAKEPOINTS = 1;
const MS2POINTS = 2;
const POINTMULTI = 3333;
const NOCOINERSTARTER = 16666;
const SIZELIMIT = 2048;
const BATCHLIMIT = 4;

const logLobby = false;
//const logPrompt = false;

//100,000 tokens gets 30 renders in an hour
//30 makes * points multi >= 100,000
//if 0 coin holders are allowed 5 free makes
//5 makes * points multi >= 3333*5 = 16665


// function enqueueTask(task) {
//     taskQueue.push(task);
//     task.timestamp = Date.now()
//     console.log(`Task enqueued for chatId: ${task.message.chat.id}`);
//     if (!isSorting) {
//         // isSorting = true;
//         sortTaskQueue();
//         isSorting = false;
//     }
//     if (taskQueue.length === 1) {
//         // If queue was empty, start processing tasks
//         processQueue();
//     }
// }
async function enqueueTask(task) {
    const { message, promptObj } = task;
    // if(promptObj.type == 'MAKE'){
    //     const run_id = await generateImage(message, promptObj);
    // } else {
        const run_id = await generateImg2Vid(message, promptObj);
    //}
    
    console.log('we have run id',run_id);
    task = {
        message: message,
        run_id: run_id,
        timestamp: Date.now(),
        checkback: 5000 // default checkback time is 5000ms (5 seconds)
    };

    taskQueue.push(task);
    
    console.log(`Task enqueued for chatId: ${message.chat.id}`);
    
    // if (!isSorting) {
    //     sortTaskQueue();
    //     isSorting = false;
    // }

    if (taskQueue.length === 1) {
        // If queue was empty, start processing tasks
        processQueue();
    }
}

let isSorting = false; 

function sortTaskQueue() {
    //console.log('queue before sort', taskQueue);
    console.log(`\n CURRENT TASK QUEUE \n`);
    console.log(`Total tasks in queue: ${taskQueue.length}`);

    taskQueue.forEach(task => {
        console.log(`\nMessage: ${task.message.chat.id}`);
        
        // Extracting properties from promptObj
        const { wallet, balance, prompt, points, type } = task.promptObj;
        console.log(`Wallet: ${wallet}`);
        console.log(`Balance: ${balance}`);
        console.log(`Prompt: ${prompt}`);
        console.log(`Points: ${points}`);
        console.log(`Type: ${type}`);

        console.log(`Timestamp: ${task.timestamp}`);
    });
    if (isSorting) {
        console.log('currently sorting')
        return; // Exit if sorting is already in progress
    }
    isSorting = true;
    try {
        taskQueue.sort((a, b) => {
            // Check if a.promptObj and b.promptObj exist
            if (!a.promptObj || !b.promptObj) {
                console.warn('promptObj is undefined for some items:', a, b);
                return 0; // No change in order
            }

            const balanceA = a.promptObj.balance || 0;
            const balanceB = b.promptObj.balance || 0;

            // Check if balanceA and balanceB are of the same type
            if (typeof balanceA !== 'number' || typeof balanceB !== 'number') {
                console.warn('balance is not a number for some items:', a, b);
                return 0; // No change in order
            }

            const timestampA = a.timestamp || 0;
            const timestampB = b.timestamp || 0;

            // Calculate waiting time for each task
            const waitingTimeA = Date.now() - timestampA;
            const waitingTimeB = Date.now() - timestampB;

            // If waiting time is over 20 seconds, prioritize it regardless of balance
            if (waitingTimeA >= 20000 && waitingTimeB < 20000) {
                return -1; // Move a to the front
            } else if (waitingTimeB >= 20000 && waitingTimeA < 20000) {
                return 1; // Move b to the front
            }

            // If waiting times are less than 20 seconds, prioritize based on balance
            // If balance is the same, sort by longer waiting time first
            if (balanceB === balanceA) {
                return waitingTimeB - waitingTimeA; // Longer waiting time first
            }

            return balanceB - balanceA; // Descending order by balance
        });
 
        } catch (error) {
            console.error('Error sorting taskQueue:', error);
        } finally {
            console.log(`\n SORTED TASK QUEUE \n`);
            console.log(`Total tasks in queue: ${taskQueue.length}`);
        
            taskQueue.forEach(task => {
                console.log(`\nMessage: ${task.message.chat.id}`);
                
                // Extracting properties from promptObj
                const { wallet, prompt, points, type, balance } = task.promptObj;
                console.log(`Wallet: ${wallet}`);
                console.log(`Balance: ${balance}`);
                console.log(`Prompt: ${prompt}`);
                console.log(`Points: ${points}`);
                console.log(`Type: ${type}`);
        
                console.log(`Timestamp: ${task.timestamp}`);
            });
        }
        
}

// async function processQueue() {
//     if (taskQueue.length > 0) {
//         const task = taskQueue[0];
//         if (task.promptObj.type === 'MAKE') {
//             await processMakeCommand(task);
//         } else if (task.promptObj.type === 'MS2') {
//             await processShakeMs2(task);
//         }
//         //console.log(taskQueue);
//         taskQueue.shift(); // Dequeue processed task
//         processQueue(); // Continue processing next task
//     } else {
//         console.log('Queue is empty.');
//     }
// }

async function processQueue() {
    if (taskQueue.length > 0) {
        const task = taskQueue[0];
        const { run_id, timestamp, checkback } = task; // Destructure run_id, timestamp, and checkback from the task

        // Calculate the next scheduled check time
        const nextCheckTime = timestamp + checkback;

        // Check if NOW is greater than nextCheckTime
        if (Date.now() >= nextCheckTime) {
            try {
                // Check the status of the task using run_id
                const { progress, status } = await fetchWorkflowOutput(run_id);

                // Adjust checkback time based on progress
                const adjustedCheckback = progress > 0.8 ? 2000 : task.checkback;

                if (status === 'success') {
                    // Task completed successfully, handle the output
                    await handleTaskCompletion(task);
                    
                    // Remove the completed task from taskQueue
                    const index = taskQueue.findIndex(t => t.run_id === run_id);
                    if (index !== -1) {
                        taskQueue.splice(index, 1);
                    }

                    // Continue processing next task
                    processQueue();
                } else if (status === 'failed') {
                    console.error('Task failed:', task.message);
                    
                    // Remove the failed task from taskQueue
                    const index = taskQueue.findIndex(t => t.run_id === run_id);
                    if (index !== -1) {
                        taskQueue.splice(index, 1);
                    }

                    // Continue processing next task
                    processQueue();
                } else {
                    // Task is still running or not yet started, continue checking
                    await new Promise(resolve => setTimeout(resolve, adjustedCheckback));
                    processQueue();
                }
            } catch (error) {
                console.error('Error fetching workflow status:', error);
                
                // Continue checking after the default checkback time
                await new Promise(resolve => setTimeout(resolve, task.checkback));
                processQueue();
            }
        } else {
            // Calculate the delay for the timeout
            const delay = nextCheckTime - Date.now();
            console.log('brb when checkback is due');
            // Set a timeout to come back and process the queue when the checkback is due
            setTimeout(processQueue, delay);
        }
    } else {
        console.log('Queue is empty.');
    }
}

// async function processMakeCommand(task) {
//     const { message, promptObj } = task;
//     const chatId = message.chat.id;

//     try {
//         const { time, filenames } = await generateImage(message, promptObj);
//         for (let i = 0; i < filenames.length; i++) {
//             //await bot.sendPhoto(chatId, filenames[i]);
//             await new Promise(resolve => setTimeout(resolve, 100));
//         }
//         //closeTask(chatId, time, filenames, 'MAKE');
//     } catch (error) {
//         console.error("Error generating and sending image:", error);
//     }
// }

async function handleTaskCompletion(task) {
    const { message, promptObj } = task;
    const chatId = message.chat.id;

    try {
        // Here you can fetch the imageUrl using fetchWorkflowOutput(task.run_id)
        const { imageUrl } = await fetchWorkflowOutput(task.run_id);

        // Send the image to the user
        await bot.sendPhoto(chatId, imageUrl);

        // You can also handle the time spent or any other data if needed
        // ...

    } catch (error) {
        console.error("Error handling task completion:", error);
    }
}

async function processShakeMs2(task) {
    const { message, promptObj } = task;
    const chatId = message.chat.id;

    try {
        const result = await generateImage2Image(message, promptObj);
        let time;
        let filenames;

        if (result) {
            if (result.time) time = result.time;
            if (result.filenames) filenames = result.filenames;
        }

        if (time && filenames) {
            for (let i = 0; i < filenames.length; i++) {
                await bot.sendPhoto(chatId, filenames[i]);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            closeTask(chatId, time, filenames, 'MS2');
            userStates[chatId] = STATES.IDLE;
        } else {
            await bot.sendMessage(chatId, 'sorry idk what happened pls try again');
        }
    } catch (error) {
        console.error("Error generating image for shakeMs2:", error);
        await bot.sendMessage(chatId, 'sorry idk what happened pls try again');
    }
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

let fastestMake = 100;
let fastestMS2 = 100;
let slowestMake = 0;
let slowestMS2 = 0;
let totalPoints = 0;
let locks = 0;

let taskQueue = []

let lastCleanTime = Date.now();

const STATES = {
    IDLE: 'IDLE',
    SIGN_IN: 'SIGN_IN',
    IMG2IMG: 'IMG2IMG',
    PROMPT: 'PROMPT',
    CFG: 'CFG',
    STRENGTH: 'STRENGTH',
    INTERROGATION: 'INTERROGATION',
    SETBATCH: 'SETBATCH',
    DISC: 'DISC',
    CAPTURE: 'CAPTURE',
    SETSTEPS: 'SETSTEPS',
    SETCFG: 'SETCFG',
    SETSTRENGTH: 'SETSTRENGTH',
    SETPROMPT: 'SETPROMPT',
    SETUSERPROMPT: 'SETUSERPROMPT',
    SETNEGATIVEPROMPT: 'SETNEGATIVEPROMPT',
    SETSEED: 'SETSEED',
    SETPHOTO: 'SETPHOTO',
    SETSIZE: 'SETSIZE',
    REQUEST: 'REQUEST',
    PFP: 'PFP',
    MS3: 'MS3',
    // Add more states as needed
};

const lobby = {};

/*
{
    chatId: {userData},
    chatId: {userData},
}
*/
const userStates = {};
// const userPrompts = {};


setInterval(cleanLobby, 60 * 60 * 1000);
if(logLobby){
    setInterval(printLobby, 60000);
}
setInterval(netflix, 2 * 60 * 60 * 1000);
//setInterval(generateReport, 10 * 60 * 1000);

function cleanLobby() {
    for (const chatId in lobby) {
        lobby[chatId].points = 0;
    }
    
    console.log("The lobby is clear");
    lastCleanTime = Date.now(); // Update the last clean time
}

function netflix() {
    generateMasterKey();
}

function printLobby(){
    console.log(`\n CURRENT LOBBY \n`)
    console.log(Object.keys(lobby).length);
    console.log(timeTillTurnover())
        // Iterate over the keys of the lobby object
        Object.keys(lobby).forEach(chatId => {
            const userData = lobby[chatId];
            console.log(`\nChat ID: ${chatId}`);
            console.log(`Wallet: ${userData.wallet}`);
            console.log(`Prompt: ${userData.prompt}`);
            console.log(`Points: ${userData.points}`);
        });
}

async function checkLobby(message){
    const chatId = message.chat.id
    if(!lobby.hasOwnProperty(chatId)){
        const userData = getUserData(chatId);
        const balance = await getBalance(userData.wallet);
        if(userData.wallet == ''){
            bot.sendMessage(chatId,'you need to signin first');
            return false
        }
        if(checkBlacklist(userData.wallet)){
            await bot.sendMessage(message.chat.id,`you are either on the blacklist or pretending to be the raydium pool lol gtfo`)
            return '';
        }
        lobby[chatId] = {
            ...userData,
            balance: balance,
            points: 0
        }
        console.log(message.from.first_name,"has entered the chat");
        return true
    } else {
        if(lobby[chatId].balance == '' && lobby[chatId].wallet != ''){
            lobby[chatId].balance = await getBalance(lobby[chatId].wallet);
        }
        let points = lobby[chatId].points;
        if (pointsCalc(points) > lobby[chatId].balance + NOCOINERSTARTER){
            bot.sendMessage(chatId,`I am sorry, you have reached your limit, please try again in ${timeTillTurnover()}`)
            ++locks;
            return false
        }
        return true;
    }
}

function timeTillTurnover() {
    const currentTime = Date.now();
    const timePassed = currentTime - lastCleanTime;
    const minutesLeft = 60 - Math.floor((timePassed % (1000 * 60 * 60)) / (1000 * 60));

    return minutesLeft;
}

function pointsCalc(points) {
    return points * POINTMULTI;
}

async function generateReport() {
    // Get the current date and time
    const currentDate = new Date();
    const timestamp = currentDate.toISOString().replace(/:/g, '-').replace(/\..+/, '');

    // Define the report data
    const reportData = {
        fastestMake: fastestMake,
        fastestMS2: fastestMS2,
        totalPoints: totalPoints,
        locks: locks,
        lobbySize: Object.keys(lobby).length
    };

    // Create the reports folder if it doesn't exist
    const reportsFolderPath = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsFolderPath)) {
        fs.mkdirSync(reportsFolderPath);
    }

    // Define the report filename with the current timestamp
    const reportFilename = `${timestamp}.json`;
    const reportFilePath = path.join(reportsFolderPath, reportFilename);

    // Write the report data to the file
    fs.writeFileSync(reportFilePath, JSON.stringify(reportData, null, 2));

    console.log(`Report generated and saved to ${reportFilePath}`);
}

bot.on('message', async (message) => {
    if (!message || !message.chat || !message.chat.id || !message.from || !message.from.id) {
        console.error('Invalid message format:', message);
        return;
    }

    if (ignoreQueue) {
        console.log("Skipping logic because 'true' was passed as a command line argument.");
        return; // Skip further processing
    }
    
    const userId = message.from.id;
    const text = message.text;

    // Initialize state for new users
    if (!userStates[userId] || message.text == '/reset') {
        userStates[userId] = STATES.IDLE;
    }

    switch (userStates[userId]) {
        case STATES.IDLE:
            if (text === '/signin') {
                userStates[userId] = STATES.SIGN_IN;
                handleSignIn(message)
            } else if (text === '/ms2') {
                if(await checkLobby(message)){
                    userStates[userId] = STATES.IMG2IMG;
                    handleMs2(message) 
                }
            } else if (text === '/pfp') {
                if(await checkLobby(message)){
                    userStates[userId] = STATES.PFP;
                    handlePfp(message)
                }
            } else if (text === '/ms3') {
                if(await checkLobby(message)){
                    userStates[userId] = STATES.MS3;
                    handleMs3(message);
                }
            }
            break;

        case STATES.SIGN_IN:
                //console.log('made it to shake')
                    shakeSignIn(message)
                    userStates[userId] = STATES.IDLE;
            break;
        

        case STATES.IMG2IMG:
            break;

        case STATES.PFP:
            break;

        case STATES.PROMPT:
                //console.log('made it to shake')
                    const advanced = lobby[chatId].advancedUser;
                    if(advanced){
                        await handleMs2Prompt(message)
                        userStates[userId] = STATES.CFG;
                    } else {
                        await handleMs2Prompt(message)
                        userStates[userId] = STATES.IDLE;
                    }
            break;

        case STATES.CFG:
                if(await handleMs2Cfg(message)){
                    userStates[userId] = STATES.STRENGTH
                }
            break;

        case STATES.STRENGTH:
                if(await handleMs2Strength(message)){
                    userStates[userId] = STATES.IDLE;
                }
            break;
        case STATES.INTERROGATION:
            break;

        case STATES.SETBATCH:
            if(handleSetBatch(message)){
                userStates[userId] = STATES.IDLE
            }
            break;

        case STATES.CAPTURE:
            if(handleCapture(message)){
                userStates[userId] = STATES.IDLE
            }

        case STATES.DISC:
            break;

        case STATES.SETPHOTO:
            break;

        case STATES.REQUEST:
            if(handleRequest(message)){
                userStates[userId] = STATES.IDLE
            }

        // case STATES.SETBATCH:
        //         if(handleSetBatch(message)){
        //             userStates[userId] = STATES.IDLE
        //         }
        //     break;

        case STATES.SETSTEPS:
                if(handleSetSteps(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETCFG:
                if(handleSetCfg(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETSTRENGTH:
                if(handleSetStrength(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETPROMPT:
                if(handleSetPrompt(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETUSERPROMPT:
                if(handleSetUserPrompt(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETNEGATIVEPROMPT:
                if(handleSetNegative(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETSIZE:
                if(handleSetSize(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        case STATES.SETTYPE:
            if(handleSetType(message)){
                userStates[userId] = STATES.IDLE
            }
        break;

        // default:
        //     break;

        // Add more cases as needed
    }
});
bot.on('photo',async (message) => {
    if (!message || !message.chat || !message.chat.id || !message.from || !message.from.id) {
        console.error('Invalid message format:', message);
        return;
    }
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    switch (userStates[userId]) {
        case STATES.IDLE:
            if (text === '/ms2') {
                if(await handleMs2ImgFile(message)){
                    userStates[userId] = STATES.PROMPT;
                }
            }
            break;

        case STATES.IMG2IMG:
                if(await handleMs2ImgFile(message)){
                    userStates[userId] = STATES.PROMPT;
                }
            break;

        case STATES.MS3:
                if(await handleMs3ImgFile(message)){
                    userStates[userId] = STATES.IDLE;
                }
                break;

        case STATES.PFP:
            bot.sendMessage(chatId,'alright hold on');
            if(await handlePfpImgFile(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.INTERROGATION:
            bot.sendMessage(chatId,'okay lemme see...');
            if(await handleInterrogation(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.DISC:
            bot.sendMessage(chatId,'one sec..');
            if(await handleDiscWrite(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.SETPHOTO:
            bot.sendMessage(chatId,'alright hold on..');
                if(await handleSetPhoto(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        // default:
        //     break;

        // Add more cases as needed
    }
});
bot.on('document',async (message) => {
    if (!message || !message.chat || !message.chat.id || !message.from || !message.from.id) {
        console.error('Invalid message format:', message);
        return;
    }
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    switch (userStates[userId]) {
        case STATES.IDLE:
            if (text === '/ms2') {
                bot.sendMessage(chatId,'okay lemme see...');
                if(await handleMs2ImgFile(message)){
                    userStates[userId] = STATES.PROMPT;
                }
            }
            break;

        case STATES.IMG2IMG:
            bot.sendMessage(chatId,'okay lemme see...');
                if(await handleMs2ImgFile(message)){
                    userStates[userId] = STATES.PROMPT;
                }

            break;

        case STATES.MS3:
            if(await handleMs3ImgFile(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.INTERROGATION:
            bot.sendMessage(chatId,'okay lemme see...');
            if(await handleInterrogation(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.PFP:
            bot.sendMessage(chatId,'alright hold on');
            if(await handlePfpImgFile(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.DISC:
            bot.sendMessage(chatId,'one sec..');
            if(await handleDiscWrite(message)){
                userStates[userId] = STATES.IDLE;
            }
            break;

        case STATES.SETPHOTO:
            bot.sendMessage(chatId,'alright hold on..');
                if(await handleSetPhoto(message)){
                    userStates[userId] = STATES.IDLE
                }
            break;

        // default:
        //     break;

        // Add more cases as needed
    }
});



// Event listener for handling text messages
bot.onText(/^\/make (.+)/, async (message) => {
    const chatId = message.chat.id;
    //const userId = message.from.id;
    if(!await checkLobby(message)){
        return;
    }

    // if(userStates[chatId] != STATES.IDLE){
    //     return;
    // }

    const thisSeed = makeSeed(chatId);

    //save these settings into lobby in case cook mode time
    lobby[chatId] = {
        ...lobby[chatId],
        prompt: message.text.replace("/make", "").trim(),
        type: 'MAKE',
        lastSeed: thisSeed
    }

    const promptObj = {
        ...lobby[chatId]
    }
        
    try {
        bot.sendMessage(chatId,'k');
        enqueueTask({message,promptObj})
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
});
bot.onText(/^\/test (.+)/, async (message) => {
    const chatId = message.chat.id;
    //const userId = message.from.id;
    if(!await checkLobby(message)){
        return;
    }

    const thisSeed = makeSeed(chatId);
    
    lobby[chatId] = {
        ...lobby[chatId],
        prompt: message.text.replace("/make", "").trim(),
        type: 'MAKE',
        lastSeed: thisSeed
    }

    testObj = {
        ...lobby[chatId],
        steps: 18,
        batchMax: 2,
        seed: thisSeed,
        photoStats: {
            width: 512,
            height: 512
        }
    }

    //console.log('TESTING: ',lobby[chatId].prompt);
        
    try {
        const{time,filenames} = await generateImage(message, testObj);
        for(let i = 0; i < filenames.length; i++){
            await bot.sendPhoto(chatId, filenames[i]);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        closeTask(chatId,time,filenames,'MAKE');

    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
});
bot.onText(/^\/regen(.*)/, async (message) => {
    const chatId = message.chat.id;
    //const userId = message.from.id;
    if(!await checkLobby(message)){
        return;
    }

    const thisSeed = makeSeed(chatId);
    lobby[chatId].lastSeed = thisSeed;

    const promptObj = {
        ...lobby[chatId],
        seed: thisSeed,
    }
    if(lobby[chatId].type == 'MAKE'){
        try {
            bot.sendMessage(chatId,'ok')
            enqueueTask({message,promptObj})
    
        } catch (error) {
            console.error("Error generating and sending image:", error);
        }
    } else if (lobby[chatId].type == 'MS2'){
        await bot.sendMessage(chatId, 'pls wait i will make in 1 second');
        //await shakeMs2(message,promptObj)
        enqueueTask({message,promptObj})
    } else if (lobby[chatId].type == ''){
        lobby[chatId].type = 'MAKE';
        bot.sendMessage(chatId,'k');
        enqueueTask({message,promptObj})
    }
})


bot.onText(/^\/interrogate(.*)/, async (message) => {
    const chatId = message.chat.id;
    bot.sendMessage(chatId, "Send in the photo you want to reverse engineer a prompt from.");
    userStates[chatId] = STATES.INTERROGATION;
    console.log(userStates[chatId])
});
async function handleInterrogation(message) {
    const chatId = message.chat.id;
    let fileId;
    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const photoInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
    try {
        const{time,result} = await interrogateImage(message, photoUrl);
        bot.sendMessage(chatId, result)
        return true
    } catch(err){
        console.log(err);
        return false
    }
}


bot.onText(/^\/quit(.*)/, async (message) => {
    userStates[message.from.id] = STATES.IDLE;
    await bot.sendMessage(message.chat.id,'okay i reset your station, try whatever you were doing again');
});


bot.onText(/^\/getseed(.*)/, async (message) => {
    const chatId = message.chat.id;
    if(lobby[chatId]){
        await bot.sendMessage(message.chat.id,`the last seed you used was ${lobby[message.chat.id].lastSeed}`);
    } else {
        await bot.sendMessage(chatId, 'gen something and Ill tell you what seed you used');
    }
});
bot.onText(/^\/setseed(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,'what seed do you want to set to? use -1 for random');
    userStates[chatId] = STATES.CAPTURE;
});
function handleCapture(message) {
    const newSeed = parseInt(message.text)
    if(isNaN(newSeed)){
        bot.sendMessage(message.chat.id,'hey you need to input a number')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].seed = newSeed;
        bot.sendMessage(message.chat.id,`your seed is set to ${newSeed}`)
        return true
    }
}


bot.onText(/^\/setbatch(.*)/, async (message) => {
    const chatId = message.chat.id;
    if(calcBatch(chatId) > 1){
        await bot.sendMessage(chatId,`what batch do you want to set to? you can go up to ${calcBatch(chatId)}`);
        userStates[chatId] = STATES.SETBATCH;
    }
});

function calcBatch(chatId) {
    let possibleBatch;
    if(lobby[chatId]){
        possibleBatch = Math.floor(lobby[chatId].balance / 1000000) + 1;
        if(possibleBatch > BATCHLIMIT){
            possibleBatch = BATCHLIMIT;
        }
        return possibleBatch
    } else {
        bot.sendMessage(chatId,'hey, please make something first so i can see ur account')
    }
}
function handleSetBatch(message) {
    const newSet = parseInt(message.text)
    if(isNaN(newSet)){
        bot.sendMessage(message.chat.id,'hey you need to input a number')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].batchMax = newSet;
        bot.sendMessage(message.chat.id,`your batch is set to ${newSet}`)
        return true
    }
}
bot.onText(/^\/setsteps(.*)/, async (message) => {
    const chatId = message.chat.id;
    if(calcSteps(chatId) > 30){
        await bot.sendMessage(chatId,`what steps do you want to set to? you can go up to ${calcSteps(chatId)}`);
        userStates[chatId] = STATES.SETSTEPS;
    }
    
});
const STEPSLIMIT = 48;
function calcSteps(chatId) {
    let possibleSteps;
    if(lobby[chatId]){
        possibleSteps = Math.floor(lobby[chatId].balance / 1000000) + 30;
        if(possibleSteps > STEPSLIMIT){
            possibleSteps = STEPSLIMIT;
        }
        return possibleSteps
    } else {
        bot.sendMessage(chatId,'hey, please make something first so i can see ur account')
    }
}
function handleSetSteps(message) {
    const newSet = parseInt(message.text)
    if(isNaN(newSet)){
        bot.sendMessage(message.chat.id,'hey you need to input a number')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].steps = newSet;
        bot.sendMessage(message.chat.id,`your step setting is set to ${newSet}`)
        return true
    }
}
bot.onText(/^\/setcfg(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what cfg do you want to set to? you can go up to 20`);
    userStates[chatId] = STATES.SETCFG;
});
function handleSetCfg(message) {
    let newSet = parseInt(message.text)
    if(isNaN(newSet)){
        bot.sendMessage(message.chat.id,'hey you need to input a number')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        newSet > 20 ? newSet = 20 : null;
        lobby[message.chat.id].cfg = newSet;
        bot.sendMessage(message.chat.id,`your cfg setting is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/setstrength(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what strength do you want to set to? you can go up to 1 (e.g. '.5')`);
    userStates[chatId] = STATES.SETSTRENGTH;
});
function handleSetStrength(message) {
    let newSet = parseFloat(message.text)
    if(isNaN(newSet)){
        bot.sendMessage(message.chat.id,'hey you need to input a number')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        newSet > 1 ? newSet = .9 : null;
        lobby[message.chat.id].strength = newSet;
        bot.sendMessage(message.chat.id,`your strength setting is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/settype(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what type of generation are you cooking? ('MAKE'/'MS2')`);
    userStates[chatId] = STATES.SETTYPE;
});
function handleSetType(message) {
    const newSet = (message.text)
    if(!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else if (newSet != 'MAKE' || newSet != 'MS2') {
        bot.sendMessage(message.chat.id,"it needs to be either 'MAKE' or 'MS2', did i stutter?")
    } else {
        lobby[message.chat.id].type = newSet;
        bot.sendMessage(message.chat.id,`your type setting is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/setprompt(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what prompt do you want to set to?`);
    userStates[chatId] = STATES.SETPROMPT;
});
function handleSetPrompt(message) {
    const newSet = message.text;
    if(!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].prompt = newSet;
        bot.sendMessage(message.chat.id,`your prompt is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/setuserprompt(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what user base prompt do you want to set to?`);
    userStates[chatId] = STATES.SETUSERPROMPT;
});
function handleSetUserPrompt(message) {
    const newSet = message.text;
    if(!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].userBasePrompt = newSet;
        lobby[message.chat.id].userPrompt = true;
        bot.sendMessage(message.chat.id,`your user base prompt is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/toggleuserprompt(.*)/, async (message) => {
    const chatId = message.chat.id;
    if(lobby[chatId]){
        lobby[chatId].userPrompt = !lobby[chatId].userPrompt
    await bot.sendMessage(chatId,`Your user prompt will ${lobby[chatId].userPrompt ? 'be' : 'not be'} included in generations now`);    
    } else {
        bot.sendMessage(chatId,'make something first');
    }
    
});
bot.onText(/^\/setnegprompt(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what negative prompt do you want to set to?`);
    userStates[chatId] = STATES.SETPROMPT;
});
function handleSetNegative(message) {
    const newSet = parseInt(message.text)
    if(!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        lobby[message.chat.id].negativePrompt = newSet;
        bot.sendMessage(message.chat.id,`your negative prompt is now ${newSet}`)
        return true
    }
}
bot.onText(/^\/setsize(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what size (pixels) do you want to set to? you can go up to ${calcSize(chatId)} in width and height depending on token balance (e.g. '1500,500') sets 1500 WIDTH and 500 HEIGHT respectively`);
    userStates[chatId] = STATES.SETSIZE;
});
function calcSize(chatId) {
    let possibleSize;
    if(lobby[chatId]){
        possibleSize = Math.floor(lobby[chatId].balance / 1000) + 1024; //has 1000000 is 1000 1000, can go 2024
        if(possibleSize > SIZELIMIT){
            possibleSize == SIZELIMIT;
        }
        return possibleSize
    } else {
        bot.sendMessage(chatId,'hey, please make something first so i can see ur account')
    }
}
function handleSetSize(message) {
    const newSet = message.text.split(',').map(Number);
    console.log(newSet)
    if(isNaN(newSet[0]) || isNaN(newSet[1])){
        bot.sendMessage(message.chat.id,'hey you need to input <number,number>')
        return false
     } else if (!lobby[message.chat.id]) {
        bot.sendMessage(message.chat.id,"you need to make something first")
        return true
    } else {
        newSet[0] > 2048 ? newSet[0] = 2048 : null;
        newSet[1] > 2048 ? newSet[1] = 2048 : null;
        lobby[message.chat.id].photoStats.width = newSet[0];
        lobby[message.chat.id].photoStats.height = newSet[1];
        bot.sendMessage(message.chat.id,`you set size to ${newSet[0]},${newSet[1]}`)
        return true
    }
}
bot.onText(/^\/setphoto(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`what photo do you want to set to?`);
    userStates[chatId] = STATES.SETPHOTO;
});
async function handleSetPhoto(message) {
    const chatId = message.chat.id;
    //const newSet = parseInt(message.text)
    if(!lobby[chatId]) {
        bot.sendMessage(chatId,"you need to make something first")
        return true
    }
    
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    try {
        const photo = await Jimp.read(fileUrl);
        const { width, height } = photo.bitmap;

        const photoStats = {
            width: width,
            height: height
        };

        lobby[chatId] = {
            ...lobby[chatId],
            photoStats: photoStats,
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
        }
        await bot.sendMessage(chatId, `The dimensions of the photo are ${width}x${height}`);        
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        bot.sendMessage(chatId, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}
bot.onText(/^\/request(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`Give us the link to the model you want`);
    userStates[chatId] = STATES.REQUEST;
});
function handleRequest(message) {
    const chatId = message.chat.id;
    const messageContent = message.text || message.caption || ''; // Get message text or caption

    // Create directory if it doesn't exist
    const directoryPath = path.join(__dirname, 'modelRequests');
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }

    // Generate filename based on chatId and current timestamp
    const timestamp = Date.now();
    const filename = `message_${chatId}_${timestamp}.txt`;
    const filePath = path.join(directoryPath, filename);

    // Write message content to file
    fs.writeFileSync(filePath, messageContent, 'utf8');

    console.log(`Message written to file: ${filePath}`);
    bot.sendMessage(chatId,'okay we will take a look and try to get it on the bot soon');
    
}
bot.onText(/^\/savesettings(.*)/, async (message) => {
    const chatId = message.chat.id;
    await bot.sendMessage(chatId,`I'm going to save your settings so that if the bot goes down you can pick up where you left off`);
    writeUserData(chatId,lobby[chatId]);
});
bot.onText(/^\/seesettings(.*)/, async (message) => {
    const chatId = message.chat.id;
    if(lobby[chatId]){
        await bot.sendMessage(chatId,`Here is what you are working with rn ${JSON.stringify(lobby[chatId])}`);
    } else {
        let userData = getUserData(chatId)
        await bot.sendMessage(chatId,`Here is what you are working with rn ${JSON.stringify(userData)}`);
    }
    
});


bot.onText(/^\/disc(.*)/, async (message) => {
    userStates[message.from.id] = STATES.DISC;
    await bot.sendMessage(message.chat.id,'what photo or file will you write to a disc?');
});
async function handleDiscWrite(message) {
    chatId = message.chat.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    try {
        const filenames = await writeToDisc(fileUrl)
        console.log(filenames)
        await bot.sendPhoto(chatId, filenames[0]);
        closeTask(chatId,1,filenames,'DISC')
        return true;
    } catch (err) {
        console.log(err);
        await bot.sendMessage(chatId,'oh man something went horribly wrong');
        return false;
    }
}

async function handleMs3(message) {
    const chatId = message.chat.id;
    bot.sendMessage(chatId,"Send in the photo you want to img to vid");
}
async function handleMs3ImgFile(message) {
    chatId = message.chat.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const promptObj = {
        fileUrl: fileUrl
    }
    try {
        enqueueTask({message, promptObj})
        await bot.sendMessage(chatId, `Okay dont hold your breath`);        
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        bot.sendMessage(chatId, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}

async function handleMs2(message) {
    const chatId = message.chat.id;
    bot.sendMessage(chatId, "Send in the photo you want to img to img.");
};
async function handleMs2ImgFile(message) {
    chatId = message.chat.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    try {
        const photo = await Jimp.read(fileUrl);
        const { width, height } = photo.bitmap;

        const photoStats = {
            width: width,
            height: height
        };

        const thisSeed = makeSeed(chatId);
        lobby[chatId].lastSeed = thisSeed;

        lobby[chatId] = {
            ...lobby[chatId],
            lastSeed: thisSeed,
            tempSize: photoStats,
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
        }
        //console.log(lobby[chatId])
        await bot.sendMessage(chatId, `The dimensions of the photo are ${width}x${height}. What would you like the prompt to be?`);        
        return true;
    } catch (error) {
        console.error("Error processing photo:", error);
        bot.sendMessage(chatId, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}
async function handleMs2Prompt(message) {
    const chatId = message.chat.id;
    const userInput = message.text;
    userInput == '' ? userInput = '' : null;

    lobby[chatId] = {
        ...lobby[chatId],
        prompt: userInput,
        type: 'MS2'
    }

    if (lobby[chatId].advancedUser) {
        // Ask for CFG value
        await bot.sendMessage(chatId, 'Advanced mode is on. Please enter the CFG value (e.g., 7):');
    } else {
        await bot.sendMessage(chatId, 'pls wait i will make in 1 second');
        const promptObj = {
            ...lobby[chatId],
            photoStats: lobby[chatId].tempSize
        }
        //return await shakeMs2(message,promptObj);
        enqueueTask({message,promptObj})
        return true
    }
    return lobby[chatId].advancedUser;
}
async function handleMs2Cfg(message) {
    const chatId = message.chat.id;
    let cfg;
    try {
        cfg = parseInt(message.text);
        if(isNaN(cfg)){
            bot.sendMessage(chatId, 'hey i think you entered something other than a number, run that by me again')
            return false
        }
        if(cfg > 20){
            cfg = 20;
        }
        
        lobby[chatId] = {
            ...lobby[chatId],
            cfg: cfg
        }
        // Ask for strength value
        await bot.sendMessage(chatId, 'Please enter the strength value (e.g., 0.75):');
        return true
    } catch (error) {
        await bot.sendMessage(chatId, 'please enter a cfg value between 0 and 20')
        return false;
    }
}
async function handleMs2Strength(message) {
    const chatId = message.chat.id
    let strength;
    try {
        strength = parseFloat(message.text);
        if(isNaN(strength)){
            bot.sendMessage(chatId, 'hey you were supposed to put a number between 0 and 1 like this: 0.4 can you try again?')
            return false
        }
        if(strength > 1){
            strength = 1;
        }

        lobby[chatId] = {
            ...lobby[chatId],
            strength: strength
        }
        // Ask for strength value
        
        const promptObj={
            ...lobby[chatId],
            photoStats: lobby[chatId].tempSize
        }
        //return await shakeMs2(message,promptObj)
        bot.sendMessage(chatId,'k i maek')
        enqueueTask({message,promptObj})
        //await bot.sendMessage(chatId, 'pls wait i will make in 1 second');
        return true
    } catch (error) {
        console.log('ms2 strength error:',error)
        await bot.sendMessage(chatId, 'please enter a strength value between 0 and 1 (e.g., 0.4 or .4)')
        return false;
    }
}
async function shakeMs2(message, ) {
    const chatId = message.chat.id;
    let time;
    let filenames;
    const result = await generateImage2Image(message, lobby[chatId]);
    result ? result.time ? time = result.time : null : null
    result ? result.filenames ? filenames = result.filenames : null : null
            

    if(time && filenames){
        for(let i = 0; i < filenames.length; i++){
            await bot.sendPhoto(chatId, filenames[i]);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        closeTask(chatId,time,filenames,'MS2')
        userStates[chatId] = STATES.IDLE;
        return true
    } else {
        await bot.sendMessage(chatId,'sorry idk what happened pls try again')
        return false
    }
}

async function handlePfp(message) {
    const chatId = message.chat.id;
    bot.sendMessage(chatId, "Send in the pfp you want to img to img.");
};
async function handlePfpImgFile(message) {
    chatId = message.chat.id;
    let fileId, fileUrl;

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const fileInfo = await bot.getFile(fileId);
    fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const{time,result} = await interrogateImage(message, fileUrl);
    
    try {
        const photo = await Jimp.read(fileUrl);
        const { width, height } = photo.bitmap;

        const photoStats = {
            width: width,
            height: height
        };

        const thisSeed = makeSeed(chatId);
        lobby[chatId].lastSeed = thisSeed;

        lobby[chatId] = {
            ...lobby[chatId],
            lastSeed: thisSeed,
            prompt: result,
            type: 'MS2',
            fileUrl: `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`
        }
        //console.log(lobby[chatId])
        await bot.sendMessage(chatId, 'pls wait i will make in 1 second');
        const promptObj = {
            ...lobby[chatId],
            photoStats: photoStats,
        }
        //return await shakeMs2(message,promptObj);
        enqueueTask({message,promptObj})
        return true
    } catch (error) {
        console.error("Error processing photo:", error);
        bot.sendMessage(chatId, "An error occurred while processing the photo. Please send it again, or another photo.");   
        return false
    }
}


async function handleSignIn (message) {
    const chatId = message.chat.id;
    
    const chatsFolderPath = path.join(__dirname, 'chats');
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }

    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    let chatData = {};
    if (fs.existsSync(chatFilePath)) {
        // If JSON file exists, read its content
        const rawData = fs.readFileSync(chatFilePath);
        chatData = JSON.parse(rawData);
        if (chatData.wallet) {
            // If wallet address exists in chat data, user is already signed in
            bot.sendMessage(chatId, `You are signed in to ${chatData.wallet}`);
            userStates[chatId] == STATES.IDLE
        } else {
            // Ask for Solana address
            bot.sendMessage(chatId, "What's your Solana address?")
        }
    } else {
        fs.writeFileSync(chatFilePath, JSON.stringify(defaultUserData));
        bot.sendMessage(chatId, "What's your Solana address?")
    }
};
async function shakeSignIn (message) {
    const chatId = message.chat.id;
    const chatsFolderPath = path.join(__dirname, 'chats');
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }
    
    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    let chatData;
    if (fs.existsSync(chatFilePath)) {
        // If JSON file exists, read its content
        const rawData = fs.readFileSync(chatFilePath);
        chatData = JSON.parse(rawData);
    } else {
        fs.writeFileSync(chatFilePath, JSON.stringify(defaultUserData));
        chatData = defaultUserData;
    }
    //const userId = message.from.id;
    
    chatData.wallet = message.text;
    // Save updated chat data to JSON file
    fs.writeFileSync(chatFilePath, JSON.stringify(chatData));
    lobby[chatId] = chatData;
    // Confirm sign-in
    bot.sendMessage(chatId, `You are now signed in to ${message.text}`);
    userStates[chatId] = STATES.IDLE;
}
bot.onText(/^\/signout$/, async (message) => {
    const chatId = message.chat.id;

    try {
        await handleSignOut(message);
        await bot.sendMessage(chatId, "You have been signed out successfully.");
    } catch (error) {
        console.error("Error signing out:", error);
        await bot.sendMessage(chatId, "An error occurred while signing out. Please try again later.");
    }
});
async function handleSignOut(message) {
    chatId = message.chat.id;
    const chatsFolderPath = path.join(__dirname, '/chats');
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    
    //userId = message.from.id;
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }
    if (!fs.existsSync(chatFilePath)) {
        (fs.writeFileSync(chatFilePath,defaultUserData,'utf-8'))
    }
    
    let userData = JSON.parse(fs.readFileSync(chatFilePath))
    console.log(userData,'signing out');
        if (userData) {
            // Remove user data for this chatId
            userData.wallet = '';
            fs.writeFileSync(chatFilePath, JSON.stringify(userData, null, 2))
            if(lobby[chatId]){delete lobby[chatId]}
        } else {
            // User data not found
            if(lobby[chatId]){delete lobby[chatId]}
        }
    //bot.sendMessage(chatId,'You are signed out');
    return true;
}



bot.onText(/^\/accountsettings$/, async (message) => {
    const chatId = message.chat.id;

    try {
        await handleAccountSettings(message);
    } catch (error) {
        console.error("Error getting your settings out:", error);
        bot.sendMessage(chatId, "An error occurred while adjusting your settings. Please try again later.");
    }


});
async function handleAccountSettings(message) {
    
    const chatId = message.chat.id;
    if(!await checkLobby(message)){
        return;
    }
    displayAccountSettingsMenu(chatId);
}
function displayAccountSettingsMenu(chatId) {
    // Create account settings menu keyboard
    let accountSettingsKeyboard = [
        [
            {
                text: `Advanced User: ${lobby[chatId].advancedUser ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleAdvancedUser'
            },
            {
                text: `Whale Mode: ${lobby[chatId].whaleMode ? 'Enabled' : 'Disabled'}`,
                callback_data: 'toggleWhaleMode'
            },
            
        ]
    ];

    if (lobby[chatId].whaleMode) {
        accountSettingsKeyboard[0].push(
            {
                text: `Watermark: ${lobby[chatId].waterMark ? 'ON' : 'OFF'}`,
                callback_data: 'toggleWaterMark'
            },
            {
                text: `Base Prompt ${lobby[chatId].basePrompt ? 'ON' : 'OFF'}`,
                callback_data: 'toggleBasePrompt'
            }
        );
    }

    // Send account settings menu
    bot.sendMessage(chatId, 'Account Settings:', {
        reply_markup: {
            inline_keyboard: accountSettingsKeyboard
        }
    });
}
function displayBasePromptSettingsMenu(chatId) {
    // Create account settings menu keyboard

    //const promptsObject = require('./utils/basePrompts.js');  // Update the path to your prompts object file
    
    // Transform the prompts object into keyboard buttons
    let promptSettingsKeyboard = basepromptmenu.map(prompt => [{
        text: `${prompt.name} - ${prompt.description}`,
        callback_data: `setBasePrompt_${prompt.name}`  // You can use the prompt name as a unique identifier
    }]);

    // Send account settings menu
    bot.sendMessage(chatId, 'Base Prompt Menu:', {
        reply_markup: {
            inline_keyboard: promptSettingsKeyboard
        }
    });
}

bot.onText(/^\/resetaccount$/, async (message) => {
    const chatId = message.chat.id;

    try {
        handleAccountReset(message);
    } catch (error) {
        console.error("Error getting your settings out:", error);
        bot.sendMessage(chatId, "An error occurred while adjusting your settings. Please try again later.");
    }
});
function handleAccountReset(message) {
    const chatId = message.chat.id;
    const chatsFolderPath = path.join(__dirname, 'chats');
    if (!fs.existsSync(chatsFolderPath)) {
        fs.mkdirSync(chatsFolderPath);
    }
    
    // Check if JSON file exists for this chat ID
    const chatFilePath = path.join(chatsFolderPath, `${chatId}.json`);
    let chatData;
    if (fs.existsSync(chatFilePath)) {
        // If JSON file exists, read its content
        const rawData = fs.readFileSync(chatFilePath);
        chatData = JSON.parse(rawData);
    } else {
        fs.writeFileSync(chatFilePath, JSON.stringify(defaultUserData));
    }
    //const userId = message.from.id;
    let wallet = chatData.wallet;
    chatData =defaultUserData;
    chatData.wallet = wallet;
    // Save updated chat data to JSON file
    fs.writeFileSync(chatFilePath, JSON.stringify(chatData));
    if(lobby[chatId]){lobby[chatId] = chatData;}

    // Confirm sign-in
    bot.sendMessage(chatId, `You reset to default settings`);
    userStates[chatId] = STATES.IDLE;
}


bot.onText(/^\/loralist$/, (message) => {
    const chatId = message.chat.id;

   sendLoRaModelFilenames(chatId);
});
// Function to send LoRa model filenames to chat
function sendLoRaModelFilenames(chatId) {
    
// Constant for LoRa model folder path
    const LORA_MODEL_FOLDER_PATH = "M:/stable-diffusion-webui/models/Lora"; // Update the path as needed
    const ignoreList = []; // Add filenames to ignore here
    // Check if LoRa model folder exists
    if (fs.existsSync(LORA_MODEL_FOLDER_PATH)) {
        // Read filenames in LoRa model folder
        fs.readdirSync(LORA_MODEL_FOLDER_PATH).forEach(filename => {

            // Remove file extension from filename
            const filenameWithoutExtension = path.parse(filename).name;
            if (ignoreList.includes(filenameWithoutExtension)) {
                console.log(`Ignoring filename ${filename}.`);
                return; // Skip to next iteration
            }
            const filenameWithoutUnderscore = filenameWithoutExtension.replace(/_/g, ' ');
            // Send message to chat with filename in desired format
            bot.sendMessage(chatId, `<lora:${filenameWithoutExtension}:.8> ${filenameWithoutUnderscore}`)
                .then(() => {
                    console.log(`Sent filename ${filenameWithoutExtension} to chatId ${chatId}.`);
                })
                .catch(error => {
                    console.error(`Error sending filename ${filenameWithoutExtension} to chatId ${chatId}:`, error);
                });
        });
    } else {
        console.log('LoRa model folder does not exist.');
    }
}

bot.on('callback_query', (callbackQuery) => {
    //console.log(callbackQuery.data);
    const chatId = callbackQuery.message.chat.id;
    
    switch (callbackQuery.data) {
        case 'toggleAdvancedUser':
            bot.answerCallbackQuery(callbackQuery.id, { text: `Advanced User setting updated to ${!lobby[chatId].advancedUser ? 'enabled' : 'disabled'}.` });
            lobby[chatId].advancedUser = !lobby[chatId].advancedUser;
            fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2));
            break;

        case 'toggleWhaleMode':
            if(lobby[chatId].balance >= 1000000){
                lobby[chatId].whaleMode = true;
                bot.sendMessage(chatId,'hohoho we have an esteemed whale gentlemen in our midst. thank you for genning with us, sir. enjoy your updated account settings')
                fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2));
                bot.answerCallbackQuery(callbackQuery.id, { text: `Whalemode setting updated to ${lobby[chatId].whaleMode ? 'enabled' : 'disabled'}.` });
            } else {
                bot.sendMessage(chatId,`You need 1M to be elliglble for whale mode gg`);
            }
            break;

        case 'toggleWaterMark':
            if(lobby[chatId].whaleMode){
                lobby[chatId].waterMark = !lobby[chatId].waterMark
                fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2))
                bot.answerCallbackQuery(callbackQuery.id, { text: `WaterMark option updated to ${lobby[chatId].waterMark ? 'ON' : 'OFF'}`});
            } else {
                bot.sendMessage(chatId,'youre not a whale, the watermark stays on');
            }
            break;

        case 'toggleBasePrompt':
            if(lobby[chatId].whaleMode){
                //lobby[chatId].basePrompt = !lobby[chatId].basePrompt
                //fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2))
                //bot.answerCallbackQuery(callbackQuery.id, { text: `Base Prompt has been turned ${lobby[chatId].basePrompt ? 'ON' : 'OFF'}`});
                displayBasePromptSettingsMenu(chatId);
            } else {
                bot.sendMessage(chatId,'youre not a whale, the base prompt stays on');
            }
            break;

        case 'setBasePrompt_MS2.2':
        case 'setBasePrompt_MS2.1':
        case 'setBasePrompt_konaS2':
        case 'setBasePrompt_memesteenS2':
        case 'setBasePrompt_brainMS2':
        case 'setBasePrompt_alexMS2':
        case 'setBasePrompt_empty':
            const selectedName = callbackQuery.data.split('_')[1];
            console.log(selectedName);
            const basePrompt = getBasePromptByName(selectedName);
            console.log(basePrompt);
            if (basePrompt) {
                lobby[chatId].basePrompt = selectedName; // Set base prompt name
                //fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2));
                bot.sendMessage(chatId, `Base prompt set to: ${selectedName}`);
            } else if (basePrompt == ''){
                lobby[chatId].basePrompt = selectedName; // Set base prompt name
                //fs.writeFileSync(path.join(__dirname, 'chats', `${chatId}.json`), JSON.stringify(lobby[chatId], null, 2));
                bot.sendMessage(chatId, `Base prompt set to: ${selectedName}`);
            } else {
                bot.sendMessage(chatId, 'Error: Base prompt not found');
            }
            break;
            
        // default:
        //     break;
    }

        bot.editMessageText('Account Settings:', {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            //reply_markup: opts.reply_markup
        });
});

function getBasePromptByName(name) {
    const promptObj = basepromptmenu.find(prompt => prompt.name === name);
    return promptObj ? promptObj.baseprompt : null;
}

bot.onText(/^\/help$/, (message) => {
    const chatId = message.chat.id;

    const helpMessage = `
    HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHIS BOT ON TELEGRAM

    TYPE IN /make + a prompt (dont just use the command)
    and you will receive an image
    use the /pfp command and send in a photo after the response to automatically receive an img2img that was prompted for you
    use the /ms2 command to initiate an img2img, send a photo, provide a prompt and sit back
    use /interrogate to create a prompt based on a photo you provide
    use /regen to try another version of your last one
    
    ADVANCED USE
    heres where we are currently developing a lot and you may find some new features. 
    Use the /accountsettings command to bring up a menu. If you have >1M tokens or have been blessed by the dev, you may turn it on and youll be able to remove the watermark from your renders
    
    SETTERS
    for /regen purposes, we have provided setter commands to tweak what your workspace sends to stable diffusion
    /setprompt
    /setcfg
    /setstrength (only applies to img2img)
    /setseed
    /setnegativeprompt
    /setsize (sdxl really loves 1024x1024 so dont go too crazy)
    /setbatch 
    /setsteps
    /setphoto

    /setuserprompt sets an additional baseprompt to be added to all generations while it is activated, you can input loras here as well
    to toggle its activation use /toggleuserprompt
    
    if you are really onto something please be sure to use /savesettings in case the bot crashes you will be able to pick up where you left off
    you can also use /getseed to see what seed was used for the last image so you can farm good generation seeds
    using these features, you will be cooking fr
    If you make a mess of your account and want to start fresh use /resetaccount
    
    TROUBLESHOOTING
    
    First of all if you find a bug go to the techsupport channel and tell the dev, hes trying to make the bot perfect so pls help
    
    If you are stuck in some sort of UI call and rsponse loop or if you change your mind in the middle of one, use the /quit command
    If you are unsure whether the bot is alive use the /status command
    If your settings are all wonky, try /resetaccount
    
    EXTRA
    
    If you have a model you want me to check out use the /request command and shoot it in here ill take a look
    bot.sendMessage(chatId, helpMessage);
    Try the /loralist command to see what LORAs we offer along with their key words, just copy the message text and paste it somewhere in your prompt`

    bot.sendMessage(chatId, helpMessage);
});
bot.onText(/^\/status$/, (message) => {
    const chatId = message.chat.id;

    const helpMessage = `i am alive and have been for ${(Date.now() - startup)/1000} seconds`

    bot.sendMessage(chatId, helpMessage);
});

function closeTask(chatId,time,filenames,type) {
    if(time && filenames){
        for(let i = 0; i < filenames.length; i++){
            fs.unlinkSync(filenames[i]);
        }
        
    }

    if(type == 'MAKE'){
        if(time < fastestMake){
            fastestMake = time;
        }
        lobby[chatId].points += MAKEPOINTS;
        totalPoints += MAKEPOINTS;
    } else if (type == 'MS2'){
        if(time < fastestMS2){
            fastestMS2 = time;
        }
        lobby[chatId].points += MS2POINTS;
        totalPoints += MAKEPOINTS;
    } else if (type == 'DISC'){
        return
    }
}

function makeSeed(chatId) {
    if(lobby[chatId].seed == -1){
        return Math.floor(Math.random() * 1000000);
    } else {
        return lobby[chatId].seed;
    }
}