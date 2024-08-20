require("dotenv").config()

const { getBotInstance } = require("./utils/bot/bot.js");
const bot = getBotInstance();
const watch = require('./utils/bot/handlers/iMessage.js')
//const watch = require('./utils/bot/watch.js')
const wait = require('./utils/bot/handlers/iCallbaq.js')
//const wait = require('./utils/bot/menu.js')

watch(bot);
wait(bot);

console.log('app has been touched');
module.exports = {
    getBot: function () {
        return bot;
    }
}