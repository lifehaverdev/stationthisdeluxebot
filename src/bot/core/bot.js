const {
    lobby, 
    workspace, studio, abacus,
    globalStatus,
    stateHandlers,
    actionMap, prefixHandlers, commandRegistry,
    rooms, flows, burns, loraTriggers,
    taskQueue, waiting, processes, successors, failures,
    startup,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES,
    makeSeed,
    getBurned,
    getGroup, getGroupById,
} = require('./core.js');
const TelegramBot = require("node-telegram-bot-api");

const botToken = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(botToken,
    {
        polling: true
    });
const startup = Date.now();


async function getPhotoUrl(input) {
    let fileId;

    if (input.photo) {
        // Case when the entire message object is passed
        fileId = input.photo[input.photo.length - 1].file_id;
    } else if (input.document) {
        // Case when the message contains a document
        fileId = input.document.file_id;
    } else if (input.file_id) {
        // Case when a single photo or document is passed directly
        fileId = input.file_id;
    } else {
        return;
    }

    try {
        const photoInfo = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
        return photoUrl;
    } catch (error) {
        console.error("Error fetching photo URL:", error);
        return null;
    }
}

function getNextPeriodTime(startup) {
    const currentTime = Date.now();
    const elapsedMilliseconds = currentTime - startup;
    const eightHoursInMilliseconds = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

    // Calculate remaining milliseconds until the next 8-hour period
    const remainingMilliseconds = eightHoursInMilliseconds - (elapsedMilliseconds % eightHoursInMilliseconds);

    // Convert remaining time to minutes
    const remainingMinutes = Math.floor(remainingMilliseconds / 1000 / 60);

    return remainingMinutes;
}

module.exports = {
    getBotInstance: function () {
        return bot;
    },
    makeSeed,
    getPhotoUrl,
    getNextPeriodTime,
    getBurned,
    getGroup, getGroupById,
    lobby, 
    workspace, studio, abacus,
    globalStatus,
    stateHandlers,
    actionMap, prefixHandlers, commandRegistry,
    rooms, flows, burns, loraTriggers,
    taskQueue, waiting, processes, successors, failures,
    startup,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES
};