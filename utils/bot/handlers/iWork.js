const fs = require('fs')
const path = require('path');
const { sendMessage, setUserState, editMessage } = require('../../utils')
const { loraTriggers } = require('../../models/loraTriggerTranslate')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { lobby, STATES, startup, waiting, taskQueue, getBotInstance } = require('../bot.js')
const { txt2Speech } = require('../../../commands/speak')
const { promptAssist } = require('../../../commands/assist')

const iMenu = require('./iMenu')

const bot = getBotInstance();
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



function handleRequest(message) {
    const chatId = message.chat.id;
    const userId = message.from.first_name;
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
    fs.writeFileSync(filePath, userId + '\n' + messageContent, 'utf8');

    console.log(`Message written to file: ${filePath}`);
    sendMessage(message,'okay we will take a look and try to get it on the bot soon');
    setUserState(message,STATES.IDLE);
    return true;
}

async function sendLoRaModelFilenames(message) {
  const chatId = message.chat.id;
  let loraMessage = 'Loras:\n\n';

  const checkpointName = lobby[message.from.id]?.checkpoint;
  //console.log(checkpointName);
  let checkpointDescription = '';
  if (checkpointName) {
      const checkpoint = checkpointmenu.find(item => item.name === checkpointName);
      if (checkpoint) {
          checkpointDescription = checkpoint.description;
      }
  }
  

  const loraCategories = {
      style: [],
      character: [],
      context: [],
      featured: []
  };

  // Filter and categorize LoRAs
  loraTriggers.forEach(lora => {
    
        if(lora.hidden){
            return
        }
      if (checkpointName && checkpointDescription == lora.version && lobby[message.from.id].balance >= lora.gate) {
          //const triggerWords = lora.triggerWords.join(', ');
          //const triggerWords = lora.triggerWords.map(word => word ? `\`${word}\`` : '').join(', ');
          //const loraInfo = `\`${triggerWords}\``;
          


        let currentString = '`';

        lora.triggerWords.forEach(word => {
            if (word != '#') {
                currentString += `${word},`
            } else {
                currentString += `\` \`` 
            }
        });
        if (currentString.endsWith(',')) {
            currentString = currentString.slice(0, -1);
        }
        currentString += '`';

        const loraInfo = currentString;
        const featureInfo = `${lora.description}\nTrigger Words: ${currentString}\nToken Gate: ${lora.gate}\n`;

          // Categorize by type
          if (lora.type) {
              if (lora.type === 'style') {
                  loraCategories.style.push(loraInfo);
              } else if (lora.type === 'character') {
                  loraCategories.character.push(loraInfo);
              } else if (lora.type === 'context') {
                  loraCategories.context.push(loraInfo);
              }
          }

          // Check if featured
          if (lora.featured && lora.featured === true) {
              loraCategories.featured.push(featureInfo);
          }
      }
  });

  // Append categorized LoRAs to loraMessage
  Object.keys(loraCategories).forEach(category => {
      if (loraCategories[category].length > 0) {
          loraMessage += `${category.charAt(0).toUpperCase() + category.slice(1)}:\n`;
          loraMessage += loraCategories[category].join('\n') + '\n\n';
      }
  });

  loraMessage += 'Add one or all of the trigger words to a prompt to activate the respective lora on the generation';
  console.log(loraMessage)
  const maxMessageLength = 4096; // Telegram's max message length is 4096 characters
  if (loraMessage.length > maxMessageLength) {
      const midpoint = Math.floor(loraMessage.length / 2);
      let splitIndex = midpoint;

      // Ensure we split at a sensible point (e.g., end of a line)
      while (splitIndex > 0 && loraMessage[splitIndex] !== '\n') {
          splitIndex--;
      }

      const messagePart1 = loraMessage.substring(0, splitIndex);
      const messagePart2 = loraMessage.substring(splitIndex);

      sendMessage(message, messagePart1, {parse_mode: 'MarkdownV2'})
          .then(() => {
              sendMessage(message, messagePart2,{parse_mode: 'MarkdownV2'})
                  .then(() => {
                      console.log(`Sent split LoRA list to chatId ${chatId}.`);
                  })
                  .catch(error => {
                      console.error(`Error sending second part of LoRA list to chatId ${chatId}:`, error);
                  });
          })
          .catch(error => {
              console.error(`Error sending first part of LoRA list to chatId ${chatId}:`, error);
          });
  } else {
      sendMessage(message, loraMessage,{parse_mode: 'MarkdownV2'})
          .then(() => {
              console.log(`Sent LoRA list to chatId ${chatId}.`);
          })
          .catch(error => {
              console.error(`Error sending LoRA list to chatId ${chatId}:`, error);
          });
  }
}


function saySeed(message){
    if(lobby[message.from.id]){
        sendMessage(message,`the last seed you used was ${lobby[message.from.id].lastSeed}`);
    } else {
        sendMessage(message, 'gen something and Ill tell you what seed you used');
    }
}

async function shakeAssist(message) {
    const userId = message.from.id;
    const{time,result} = await promptAssist(message);
    lobby[userId].points += time;
    sendMessage(message,`\`${result}\``,{parse_mode: 'MarkdownV2'});
    setUserState(message,STATES.IDLE);
    return true
}

async function startSpeak(message, user) {
    console.log('start voice menu')
    if(user){
        message.from.id = user;
        // await editMessage({
        //     text: 'Send in the photo you want to watermark.',
        //     chat_id: message.chat.id,
        //     message_id: message.message_id
        // })
        iMenu.handleVoiceMenu(message,user)
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance < 500000){
            gated(message)
            return
        }
        //sendMessage(message, 'Send in the photo you want to watermark.',{reply_to_message_id: message.message_id})
        iMenu.handleVoiceMenu(message,user)
    }
    setUserState(message,STATES.SPEAK)
}

async function shakeSpeak(message) {
    const userId = message.from.id;
    // if(!lobby[userId].voiceModel){
    //     sendMessage(message,'please choose a voice from voice menu in account settings');
    //     return;
    // }
    const result = await txt2Speech(message, lobby[userId].voiceModel);
    //console.log(result);
    if(result == '-1'){
        sendMessage(message,'... i failed... :<')
        console.log(result);
        return 
    }
    lobby[userId].points += 5;
    await bot.sendAudio(message.chat.id,result);
    fs.unlinkSync(result);
    setUserState(message,STATES.IDLE);
    return true
}

module.exports = {
    saySeed,
    handleRequest, sendLoRaModelFilenames,
    shakeAssist, shakeSpeak, startSpeak,
    handleHelp, handleStatus
}