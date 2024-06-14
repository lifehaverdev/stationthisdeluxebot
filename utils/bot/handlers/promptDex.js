const { lobby, makeSeed } = require('../bot')
const { sendMessage } = require('../../utils')
const { writeUserData } = require('../../../db/mongodb')
const { checkLobby } = require('../gatekeep')
const { enqueueTask } = require('../queue')

async function handlePromptCatch(message, match) {
    const slot = parseInt(match[1]); // Ensure it's an integer
    const userId = message.from.id
    if (slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }

    const userSettings = lobby[userId];
    if (!userSettings) {
        sendMessage(message, "User settings not found.");
        return;
    }

    const prompt = userSettings.prompt;

    userSettings.promptdex[slot - 1] = prompt;
    writeUserData(userId,userSettings);
    sendMessage(message, `Prompt saved to slot ${slot} and settings saved`);
}

async function handleDexMake(message, match) {
    const chatId = message.chat.id;
    const userId = message.from.id;

    if (!await checkLobby(message)) {
        return;
    }

    const slot = parseInt(match[1], 10);
    if (isNaN(slot) || slot < 1 || slot > 6) {
        sendMessage(message, "Invalid slot number. Please choose a slot between 1 and 6.");
        return;
    }

    const userSettings = lobby[userId];
    if (!userSettings) {
        sendMessage(message, "User settings not found.");
        return;
    }
    
    const prompt = userSettings.promptdex[slot - 1];
    if (!prompt) {
        sendMessage(message, `No prompt saved in slot ${slot}.`);
        return;
    }

    const thisSeed = makeSeed(userId);
    lobby[userId].lastSeed = thisSeed;

    let batch;
    if (chatId < 0) {
        batch = 1;
    } else {
        batch = userSettings.batchMax;
    }

    userSettings.prompt = prompt; // Update prompt with selected slot
    userSettings.type = 'MAKE';
    userSettings.lastSeed = thisSeed;

    const promptObj = {
        ...userSettings,
        seed: thisSeed,
        batchMax: batch,
        prompt: prompt
    };
    
    try {
        sendMessage(message, 'k');
        enqueueTask({ message, promptObj });
    } catch (error) {
        console.error("Error generating and sending image:", error);
    }
}

module.exports = { handleDexMake, handlePromptCatch }