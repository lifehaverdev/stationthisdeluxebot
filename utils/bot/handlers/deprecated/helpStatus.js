const { startup, waiting, taskQueue } = require('../../bot.js')
const { sendMessage, editMessage } = require('../../../utils.js')
//const {  } = require('../queue.js')

function handleHelp(message) {
    const helpMessage = `
    HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHIS BOT ON TELEGRAM

    Use /signin to connect a solana wallet holding $MS2
    verify it on our site by pasting the hash in your chat when prompted

    /create - txt2image + chatgpt prompt augmentation + image interrogation
    /effect - img2img + auto prompt img2img (great for simply applying a baseprompt)
    /animate - img2video + txt2speech
    /set - set parameters for generation
    /status - see what the bot is workin on
    
    Use the /accountsettings command to bring up a menu. This is where you toggle watermark as well as choose a voice for speak command
    
    if you are really onto something please use /savesettings to lock in
    you can also use /getseed to see what seed was used for the last image so you can farm good generation seeds
    
    TROUBLESHOOTING
    
    First of all if you find a bug tell the dev @arthurtmonyman, hes trying to make the bot perfect so pls help
    
    If you are stuck in some sort of UI call and response loop or if you change your mind in the middle of one, use the /quit command
    If you are unsure whether the bot is alive use the /status command
    If your settings are all wonky, try /resetaccount or /signout and /signin again. you won't have to reverify
    
    EXTRA
    
    If you bought or burned and want to see your new balance try /ibought
    Try the /loralist command to see what LORAs we offer along with their key words, just use the trigger word somewhere in your prompt to activate it`

    sendMessage(message, helpMessage);
}
async function handleStatus(message) {
    // console.log('message in handleStatus',message);
    //console.log('waiting in handleStatus',waiting);
    let msg = 
    `I have been running for ${(Date.now() - startup) / 1000} seconds.\n`
    taskQueue.length > 0 ? msg +=    
    `Waiting: \n${taskQueue.map(task => {
        const username = task.message.from.username || 'Unknown'; // Get the username or use 'Unknown' if not available
        return `${username}: ${task.promptObj.type}`; // Include remaining time in the status
    }).join('\n')}\n` : null

    waiting.length > 0 ? msg += 
    `Working on: \n${waiting.map(task => {
        const username = task.message.from.username || 'Unknown'; // Get the username or use 'Unknown' if not available
        const remainingTime = task.status; // Calculate remaining time until checkback
        return `${username}: ${task.promptObj.type} ${remainingTime}`; // Include the username in the status
    }).join('\n')}\n` : null
    const sent = await sendMessage(message, msg);
    //const baseData = makeBaseData(sent,sent.from.id);
    //const callbackData = compactSerialize({ ...baseData, action: `refresh`});
    const callbackData = 'refresh'
    const chat_id = sent.chat.id;
    const message_id = sent.message_id;
    const reply_markup = { inline_keyboard: [[{ text: '🔄', callback_data: callbackData}]]}
    editMessage(
        {
            reply_markup,
            chat_id,
            message_id
        }
        )
}

module.exports = { handleHelp, handleStatus }