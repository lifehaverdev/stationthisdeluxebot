require("dotenv").config()

const { getBotInstance, globalStatus } = require("./utils/bot/bot.js");
const GlobalStatusDB = require('./db/models/globalStatus');
const globalStatusDB = new GlobalStatusDB();

const bot = getBotInstance();
const watch = require('./utils/bot/handlers/iMessage.js')
const wait = require('./utils/bot/handlers/iCallbaq.js')


watch(bot);
wait(bot);


// Set up periodic refresh of globalStatus
setInterval(async () => {
    try {
        await globalStatusDB.refreshGlobalStatus(globalStatus);
    } catch (error) {
        console.error('Error refreshing global status:', error);
    }
}, 5 * 60 * 1000);

// Initial load of globalStatus
globalStatusDB.refreshGlobalStatus(globalStatus)
    .catch(error => console.error('Error during initial global status load:', error));


console.log('app has been touched');
module.exports = {
    getBot: function () {
        return bot;
    }
}