const fs = require('fs')
const path = require('path');
const { sendMessage, setUserState, editMessage, react } = require('../../utils')
const { loraTriggers } = require('../../models/loraTriggerTranslate')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { lobby, STATES, startup, waiting, taskQueue, getBotInstance, getPhotoUrl, successors } = require('../bot.js')
const { txt2Speech } = require('../../../commands/speak')
const { promptAssist } = require('../../../commands/assist')

const iMenu = require('./iMenu');
const { getBalance } = require('../../users/checkBalance.js');
const { getGroup } = require('./iGroup')

const bot = getBotInstance();
function handleHelp(message) {
    const group = getGroup(message)
    let helpMessage;
    if(message.chat.id < 0) {
        if(group) {
            helpMessage = 
`
Welcome to ${group.name} where you can use me, ${process.env.BOT_NAME} to create images from thin air

The host has very graciously sponsored your use of the bot and took care of parameters

All you have to do is come up with a prompt that describes the image you want to make, then using the following syntax:

>> /make description of the image you want to make

The bot will handle the rest!

You may also use the /create /effect /utils /animate menus if the group owner allows

Enjoy <3
`
        } else {
            helpMessage = 
`
HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHISBOT ON TELEGRAM

1. Getting Started
• Use /signin to connect a solana wallet holding $MS2
• Verify it on our site by pasting the hash in your chat when prompted

2. Get Cooking With Various Commands

/create - Best for generating from scratch
/effect - Generate from or modify existing images
/animate - Generate txt2speech or img2video

Try using Pose, Style, or Canny to increase your control over the outcome
Use /loralist to find out the trigger words for our various additional models you can activate

Powered by $MS2
`
        }
    } else {
        helpMessage = 
`
HOW TO MAKE SILLY PICTURES AND BEAUTIFUL GENERATIONS WITH OUR PRECIOUS STATIONTHISBOT ON TELEGRAM

1. Getting Started
• Use /signin to connect a solana wallet holding $MS2
• Verify it on our site by pasting the hash in your chat when prompted

2. Get Cooking With Various Commands

/create - Best for generating from scratch
/effect - Generate from or modify existing images
/animate - Generate txt2speech or img2video
/utils - remove background, upscale, prompt assist


3. Save Your Progress
/savesettings - Lock in your settings when you're onto something good
/getseed - Check the seed used for the last image to farm good generation seeds

4. Advanced Features
/accountsettings - view point balance, $MS2 holdings, and toggle control/style/pose
/loralist - view the lora activation trigger words. Include a number after the trigger word to contorl the strength of the lora
TROUBLESHOOTING

Found a bug? 
Tell the dev, @arthurtmonyman. He's trying to make the bot perfect, so pls help.

Stuck in a UI call and response loop or change your mind?
Use /quit command    

Is the bot still alive?
Use the /status command

Check your balance
If you bought or burned and want to see your new balance, try /ibought

COMING SOON

Custom groupchats
Home Pages / Webui
Collection Mode

Powered by $MS2
`
    }
    

    sendMessage(message, helpMessage);
}

function convertTime(timeInSeconds) {
    const secondsInMinute = 60;
    const secondsInHour = 60 * 60;
    const secondsInDay = 24 * 60 * 60;
    const secondsInWeek = 7 * 24 * 60 * 60;

    if (timeInSeconds >= secondsInWeek) {
        const weeks = Math.floor(timeInSeconds / secondsInWeek);
        return `${weeks} week${weeks > 1 ? 's' : ''}`;
    } else if (timeInSeconds >= secondsInDay) {
        const days = Math.floor(timeInSeconds / secondsInDay);
        return `${days} day${days > 1 ? 's' : ''}`;
    } else if (timeInSeconds >= secondsInHour) {
        const hours = Math.floor(timeInSeconds / secondsInHour);
        return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (timeInSeconds >= secondsInMinute) {
        const minutes = Math.floor(timeInSeconds / secondsInMinute);
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
        return `${timeInSeconds} second${timeInSeconds > 1 ? 's' : ''}`;
    }
}

async function handleStatus(message) {
    // console.log('message in handleStatus',message);
    //console.log('waiting in handleStatus',waiting);
    const runtime = (Date.now() - startup) / 1000; // Time in seconds
    let msg = 
    `I have been running for ${convertTime(runtime)}.\n`
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
    }).join('\n')}\n` : null;
    successors.length > 0 ? msg += 
    `Sending: \n${successors.map(task => {
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

async function loraList(message) {
    const chatId = message.chat.id;
    let loraMessage = 'Top 10 LoRa Triggers 🔥\n';
    loraMessage += 'click to copy\n'

    // Sort LoRAs by `uses` and get the top 10
    const top10Loras = loraTriggers
        .filter(lora => lora.uses && !lora.hidden) // Filter out hidden LoRAs and those without `uses`
        .sort((a, b) => b.uses - a.uses) // Sort by `uses` in descending order
        .slice(0, 10); // Get the top 10

    
    // Build message for the top 10 LoRAs
    top10Loras.forEach(lora => {
        let currentString = '\n`';
        lora.triggerWords.forEach(word => {
            if (word != '#') {
                currentString += `${word}, `
            } else {
                currentString += `\` \`` 
            }
        })
        if (currentString.endsWith(',')) {
            currentString = currentString.slice(0, -1);
        }
        //let triggerWords = '`' + lora.triggerWords.filter(word => word !== '#').join(',') + '`';
        currentString += '`';
        loraMessage += currentString;
    });
    
    loraMessage += '\n\nSelect a category to view more LoRA trigger words:';

    // Inline keyboard options for different modes of display
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Featured', callback_data: 'featuredLora' },
                    //{ text: 'Favorites', callback_data: 'recent_uses' },
                    { text: 'Full List', callback_data: 'fullLora' }
                ],
                [
                    { text: 'Flux', callback_data: 'fluxLora'}
                ]
            ]
        },
        parse_mode: 'MarkdownV2'
    };

    // Send the message with the top 10 LoRAs and inline buttons
    try {
        await sendMessage(message, loraMessage, options);
        console.log(`Sent top 10 LoRA list to chatId ${chatId}.`);
    } catch (error) {
        console.error(`Error sending LoRA list to chatId ${chatId}:`, error);
    }
}

async function featuredLoRaList(message) {
    const chatId = message.chat.id;
    let loraMessage = 'Featured LoRa Triggers ✨\n';
    loraMessage += 'click to copy\n';

    // Filter LoRAs that are featured
    const featuredLoras = loraTriggers
        .filter(lora => lora.featured === true && !lora.hidden); // Only include featured LoRAs that aren't hidden

    
    // Build message for the featured LoRAs
    featuredLoras.forEach(lora => {
        let currentString = '\n`';
        lora.triggerWords.forEach(word => {
            if (word != '#') {
                currentString += `${word}, `;
            } else {
                currentString += `\` \``;
            }
        });
        if (currentString.endsWith(',')) {
            currentString = currentString.slice(0, -1);
        }
        currentString += '`';

        loraMessage += currentString;
    });
    

    loraMessage += '\n\nSelect a category to view more LoRA trigger words:';

    // Inline keyboard options for different modes of display
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Top 10', callback_data: 'topTenLora' },
                    //{ text: 'Favorites', callback_data: 'recent_uses' },
                    { text: 'Full List', callback_data: 'fullLora' }
                ],
                [
                    { text: 'Flux', callback_data: 'fluxLora'}
                ]
            ]
        },
        parse_mode: 'MarkdownV2'
    };

    // Send the message with the featured LoRAs and inline buttons
    try {
        await sendMessage(message, loraMessage, options);
        console.log(`Sent featured LoRA list to chatId ${chatId}.`);
    } catch (error) {
        console.error(`Error sending featured LoRA list to chatId ${chatId}:`, error);
    }
}

async function fluxLoraList(message) {
    const chatId = message.chat.id;
    let loraMessage = 'Flux LoRa Triggers ✨\n';
    loraMessage += 'click to copy\n';

    // Filter LoRAs that are featured
    const featuredLoras = loraTriggers
        .filter(lora => lora.version === 'FLUX' && !lora.hidden); // Only include featured LoRAs that aren't hidden

    
    // Build message for the featured LoRAs
    featuredLoras.forEach(lora => {
        let currentString = '\n`';
        lora.triggerWords.forEach(word => {
            if (word != '#') {
                currentString += `${word}, `;
            } else {
                currentString += `\` \``;
            }
        });
        if (currentString.endsWith(',')) {
            currentString = currentString.slice(0, -1);
        }
        currentString += '`';

        loraMessage += currentString;
    });
    

    loraMessage += '\n\nSelect a category to view more LoRA trigger words:';

    // Inline keyboard options for different modes of display
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Top 10', callback_data: 'topTenLora' },
                    //{ text: 'Favorites', callback_data: 'recent_uses' },
                    { text: 'Full List', callback_data: 'fullLora' }
                ],
            ]
        },
        parse_mode: 'MarkdownV2'
    };

    // Send the message with the featured LoRAs and inline buttons
    try {
        await sendMessage(message, loraMessage, options);
        console.log(`Sent featured LoRA list to chatId ${chatId}.`);
    } catch (error) {
        console.error(`Error sending featured LoRA list to chatId ${chatId}:`, error);
    }
}


async function sendLoRaModelFilenames(message) {
  const chatId = message.chat.id;
  message.from.id = message.reply_to_message.from.id;
  let loraMessage = 'Loras:\n\n';
    console.log(message)
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
              sendMessage(message, messagePart2,{
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Top 10', callback_data: 'topTenLora' },
                            { text: 'Featured', callback_data: 'featuredLora' },
                        ],
                    ]
                },
            })
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
      sendMessage(message, loraMessage,{
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Top 10', callback_data: 'topTenLora' },
                    { text: 'Featured', callback_data: 'featuredLora' },
                ],
                [
                    { text: 'Flux', callback_data: 'fluxLora'}
                ]
            ]
        },
    })
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
    const{time,result} = await promptAssist(message,false);
    lobby[userId].points += time+5;
    sendMessage(message,`\`${result}\``,{parse_mode: 'MarkdownV2'});
    setUserState(message,STATES.IDLE);
    return true
}

async function shakeFluxAssist(message) {
    const userId = message.from.id;
    const{time,result} = await promptAssist(message,true);
    lobby[userId].points += time+5;
    sendMessage(message,`\`${result}\``,{parse_mode: 'MarkdownV2'});
    setUserState(message,STATES.IDLE);
    return true
}


async function startFluxInterrogate(message, user) {
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo for interrogation',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
        //iMenu.handleVoiceMenu(message,user)
        //sendMessage(message, 'Send in the photo for interrogation')
        setUserState(message,STATES.FLUXINTERROGATE)
    } else {
        // if(lobby[message.from.id] && lobby[message.from.id].balance < 500000){
        //     gated(message)
        //     return
        // }
        //sendMessage(message, 'Send in the photo you want to watermark.',{reply_to_message_id: message.message_id})
        sendMessage(message, 'Send in the photo for interrogation')
        setUserState(message,STATES.FLUXINTERROGATE)
    }
    
}

async function shakeFluxInterrogate(message) {
    react(message,'😇')
    const url = await getPhotoUrl(message)
    
    // Step 1: Make the POST request using fetch
    const getEventId = async (url) => {
        try {
        const response = await fetch('https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            data: [
                { path: url }
            ]
            })
        });
    
        const jsonResponse = await response.json();
        
        // Assuming the EVENT_ID is the 4th item when split by quotes (based on the original awk command)
        const eventId = JSON.stringify(jsonResponse).split('"')[3];
        console.log('Event ID:', eventId);
        return eventId;
        } catch (error) {
        console.error('Error fetching Event ID:', error);
        }
    };
  
  // Step 2: Use fetch to make a GET request to stream the event data
  const streamEventResult = async (eventId) => {
    const streamUrl = `https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat/${eventId}`;
    
    try {
      const response = await fetch(streamUrl, { method: 'GET' });
        //console.log('response in result? ',response)
      // Here we can just treat the response as text (since it's a string)
      const result = await response.text();
      // Split the result by new lines and find the line that starts with 'data:'
        const lines = result.split('\n');
        const dataLine = lines.find(line => line.startsWith('data:'));

        // Extract the part inside the brackets (JSON string) and parse it
        const jsonData = JSON.parse(dataLine.replace('data: ', ''));
        
        console.log('Parsed Data:', jsonData[0]); // Access the first item in the array
        return jsonData[0]; // Return the description as a clean string
    } catch (error) {
        console.error('Error streaming event result:', error);
    }
    };
    //sendMessage(message,jso);
    //console.log(result.data);
    // Execute both steps
    (async () => {
        const eventId = await getEventId(url);
        
        if (eventId) {
            const res = await streamEventResult(eventId);
            console.log('res ? ',res)
            sendMessage(message,res)
        }
    })();
    setUserState(message,STATES.IDLE)
    
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

async function seeGlorp(address) {
    const balance = await getBalance(address)
    console.log('balance',balance)
    return balance
}

module.exports = {
    saySeed,
    handleRequest, sendLoRaModelFilenames, 
    loraList, featuredLoRaList,
    fluxLoraList,
    shakeAssist, shakeFluxAssist,
    shakeSpeak, startSpeak,
    handleHelp, handleStatus,
    seeGlorp,
    startFluxInterrogate,
    shakeFluxInterrogate
}