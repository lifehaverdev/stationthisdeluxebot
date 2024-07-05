const { startup, waiting, taskQueue } = require('../bot.js')
const { sendMessage, editMessage } = require('../../utils.js')
//const {  } = require('../queue.js')

function handleHelp(message) {
    const helpMessage = `
    HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHIS BOT ON TELEGRAM

    TYPE IN /make + a prompt (dont just use the command)
    and you will receive an image
    use the /assist command + a smol prompt and gpt will expound on it for you if you're not feeling creative
    use the /pfp command and send in a photo after the response to automatically receive an img2img that was prompted for you
    use the /ms2 command to initiate an img2img, send a photo, provide a prompt and sit back
    use /interrogate to create a prompt based on a photo you provide
    use /regen to try another version of your last one

    use /disc to put your image on a ms2 disc
    use /watermark to brand your image with the ms2 logo
    
    ADVANCED USE
    heres where we are currently developing a lot and you may find some new features. 
    Use the /accountsettings command to bring up a menu. If you have >1M tokens or have been blessed by the dev youll be able to remove the watermark from your renders as well as change base prompts
    
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
    you can also utilize /promptcatch <SLOT> to save a prompt to 1 of 6 slots on your account
    then just use /dexmake <SLOT> to create an image with that prompt and your current settings
    If you make a mess of your account and want to start fresh use /resetaccount
    
    TROUBLESHOOTING
    
    First of all if you find a bug go to the techsupport channel and tell the dev, hes trying to make the bot perfect so pls help
    
    If you are stuck in some sort of UI call and rsponse loop or if you change your mind in the middle of one, use the /quit command
    If you are unsure whether the bot is alive use the /status command
    If your settings are all wonky, try /resetaccount or /signout and /signin again. you won't have to reverify
    
    EXTRA
    
    If you have a model you want me to check out use the /request command and shoot it in here ill take a look
    
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