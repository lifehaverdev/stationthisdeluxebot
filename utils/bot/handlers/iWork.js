const fs = require('fs')
const path = require('path');
const { sendMessage, setUserState, editMessage, react, DEV_DMS } = require('../../utils')
const { loraTriggers } = require('../../models/loraTriggerTranslate')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { voiceModels } = require('../../models/voiceModelMenu')
const { lobby, STATES, globalStatus, startup, waiting, taskQueue, workspace, getBotInstance, getPhotoUrl, successors } = require('../bot.js')
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
/account - view point balance, $MS2 holdings, access preferences and training menu
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
    const runtime = (Date.now() - startup) / 1000;
    const group = getGroup(message);
    const user = message.from.id;
    let msg = '';

    if (message.from.id == DEV_DMS) {
        msg += `💫⏳ ${convertTime(runtime)}\n`;
        
        // Check existing globalStatus variable for training
        const activeTraining = globalStatus.training?.find(t => t.status === 'TRAINING');
        if (activeTraining) {
            msg += `🔄 Training: ${activeTraining.name}\n`;
        }
        
        msg += '\n';
    } else {
        msg += '⭐️\n\n';
    }

    group ? msg += `${group.title}\n ⚡️${group.qoints}\n\n` : null;
    
    // Separate regular and cook mode tasks
    if (taskQueue.length > 0) {
        const regularTasks = taskQueue.filter(task => !task.promptObj.isCookMode);
        const cookTasks = taskQueue.filter(task => task.promptObj.isCookMode);
        const apiTasks = taskQueue.filter(task => task.isAPI);
        
        
        if (regularTasks.length > 0) {
            msg += `🪑 \n${regularTasks.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '👤'}: ${task.promptObj.type}`
            ).join('\n')}\n`;
        }
        
        if (cookTasks.length > 0) {
            msg += `👨‍🍳 \n${cookTasks.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '👤'}: COOK #${task.promptObj.collectionId}`
            ).join('\n')}\n`;
        }

        if (apiTasks.length > 0) {
            msg += `🤖 \n${apiTasks.map(task => 
                `API: ${task.promptObj.type}`
            ).join('\n')}\n`;
        }
    }

    // Similar separation for waiting tasks
    if (waiting.length > 0) {
        const regularWaiting = waiting.filter(task => !task.promptObj.isCookMode);
        const cookWaiting = waiting.filter(task => task.promptObj.isCookMode);
        const apiWaiting = waiting.filter(task => task.isAPI);
        
        
        if (regularWaiting.length > 0) {
            msg += `🪄 \n${regularWaiting.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '👤'}: ${task.promptObj.type} ${task.status}`
            ).join('\n')}\n`;
        }
        
        if (cookWaiting.length > 0) {
            msg += `🧑‍🍳 \n${cookWaiting.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '🧑🏼‍🍳'}: COOK ${task.status}`
            ).join('\n')}\n`;
        }

        if (apiWaiting.length > 0) {
            msg += `🔄 \n${apiWaiting.map(task => 
                `API: ${task.promptObj.type} ${task.status}${task.awaitedRequest ? ' (SYNC)' : ''}`
            ).join('\n')}\n`;
        }

    }

    // And for successors
    if (successors.length > 0) {
        const regularSuccessors = successors.filter(task => !task.promptObj.isCookMode);
        const cookSuccessors = successors.filter(task => task.promptObj.isCookMode);
        const apiSuccessors = successors.filter(task => task.isAPI);
        
        
        if (regularSuccessors.length > 0) {
            msg += `🕊️\n${regularSuccessors.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '👤'}: ${task.promptObj.type} attempt ${task.deliveryFail ? task.deliveryFail : 1}`
            ).join('\n')}\n`;
        }
        
        if (cookSuccessors.length > 0) {
            msg += `🍳\n${cookSuccessors.map(task => 
                `${task.promptObj.userId == user ? 'YOU' : '👤'}: COOK #${task.promptObj.collectionId} attempt ${task.deliveryFail ? task.deliveryFail : 1}`
            ).join('\n')}\n`;
        }

        if (apiSuccessors.length > 0) {
            msg += `✅\n${apiSuccessors.map(task => 
                `API: ${task.promptObj.type} complete${task.awaitedRequest ? ' (SYNC)' : ''}`
            ).join('\n')}\n`;
        }
    }
    
    const reply_markup = { inline_keyboard: [[{ text: '🔄', callback_data: 'refresh'}]]}
    sendMessage(message, msg, {reply_markup: reply_markup});
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
        currentString += `\` \\(${lora.version}\\)`;
        loraMessage += currentString;
    });
    
    loraMessage += '\n\nSelect a category to view more LoRA trigger words:';

    // Inline keyboard options for different modes of display
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    //{ text: 'Featured', callback_data: 'featuredLora' },
                    //{ text: 'Favorites', callback_data: 'recent_uses' },
                    { text: 'Full List', callback_data: 'fullLora' }
                ],
                [
                    { text: 'MAKE', callback_data: 'fluxLora'}
                ]
            ]
        },
        parse_mode: 'MarkdownV2'
    };

    // Send the message with the top 10 LoRAs and inline buttons
    try {
        await sendMessage(message, loraMessage, options);
        //console.log(`Sent top 10 LoRA list to chatId ${chatId}.`);
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
                    { text: 'MAKE', callback_data: 'fluxLora'}
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
    let loraMessage = 'MAKE LoRa Triggers ✨\n';
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
  message.from.id = message.reply_to_message?.from?.id || message.from.id;
  
  console.log('Processing request for chatId:', chatId);
  console.log('User ID:', message.from.id);

  const loraCategories = {
      style: [],
      character: [],
      context: [],
      recentlyAdded: []
  };

  // Helper function to escape special characters for MarkdownV2
  const escapeMarkdown = (text) => {
    return text.replace(/[-[\](){}+?.*\\^$|#,.!]/g, '\\$&');
  };

  // Modified LoRA processing - no checkpoint filtering
  loraTriggers.forEach(lora => {
    if(lora.hidden) {
        return;
    }
    
    console.log('Processing LoRA:', lora.name || 'unnamed', 'Version:', lora.version);
    
    let currentString = '`';
    let triggerWords = [];
    lora.triggerWords.forEach(word => {
        if (word != '#') {
            triggerWords.push(word);
        }
    });
    currentString += triggerWords.join(', ') + '`';

    // Add version information to the display with escaped special characters
    const versionInfo = lora.version ? ` \\[${escapeMarkdown(lora.version)}\\]` : '';
    const loraInfo = `${currentString}${versionInfo}`;
    

    // Categorize with version info
    if (lora.type) {
        
        if (lora.type === 'style') {
            loraCategories.style.push(loraInfo);
        } else if (lora.type === 'character') {
            loraCategories.character.push(loraInfo);
        } else if (lora.type === 'context') {
            loraCategories.context.push(loraInfo);
        }
    }

    // Add to recently added array (we'll sort and slice later)
    loraCategories.recentlyAdded.push({
        info: loraInfo,
        addedDate: lora.addedDate || new Date(0) // fallback for items without date
    });
  });

  // Sort recently added by date and take last 5
  loraCategories.recentlyAdded.sort((a, b) => a.addedDate - b.addedDate);
  loraCategories.recentlyAdded = loraCategories.recentlyAdded.slice(-5).map(item => item.info);

  // Send message for each category with debug logs
  const mainCategories = ['style', 'character', 'context'];
  
  for (const category of mainCategories) {
      if (loraCategories[category].length > 0) {
          
          let categoryMessage = `${escapeMarkdown(category.charAt(0).toUpperCase() + category.slice(1))}:\n`;
          categoryMessage += loraCategories[category].join('\n') + '\n\n';
          
         
          try {
              await sendMessage(message, categoryMessage, { 
                  parse_mode: 'MarkdownV2'
              });
              
          } catch (error) {
              console.error(`Error sending ${category} category:`, error);
          }
      } else {
          console.log(`Skipping ${category} category - no items`);
      }
  }

  // Send final message with recently added and menu
  
  let finalMessage = 'Recently Added:\n';
  finalMessage += loraCategories.recentlyAdded.join('\n') + '\n\n';
  finalMessage += 'Add one or all of the trigger words to a prompt to activate the respective lora on the generation';

  try {
      await sendMessage(message, finalMessage, {
          parse_mode: 'MarkdownV2',
          reply_markup: {
              inline_keyboard: [
                  [
                      { text: 'Top 10', callback_data: 'topTenLora' },
                  ],
                  [
                      { text: 'MAKE', callback_data: 'fluxLora'}
                  ]
              ]
          },
      });
      
  } catch (error) {
      console.error('Error sending final message:', error);
  }
}


function saySeed(message){
    if(lobby[message.from.id]){
        sendMessage(message,`the last seed you used was ${lobby[message.from.id].lastSeed}`);
    } else {
        sendMessage(message, 'gen something and Ill tell you what seed you used');
    }
}

async function shakeAssist(message, prompt = null, user = null) {
    const userId = user || message.from.id;
    const whale = lobby[userId].balance > 1000000;
    if(!user) {
        if(whale) {
            await react(message,'🍓')
        } else {
            await react(message)
        }
    }
    const{time,result} = await promptAssist({...message,text: prompt ? prompt : message.text},false,false);
    lobby[userId].points += time+5;
    sendMessage(message,`\`${result}\``,{parse_mode: 'MarkdownV2'});
    setUserState(message,STATES.IDLE);
    delete workspace[userId]
    return true
}

async function shakeFluxAssist(message, prompt = null, user = null) {
    const userId = user || message.from.id;
    const whale = lobby[userId].balance > 1000000;
    if(!user) {
        if(whale) {
            await react(message,'🍓')
        } else {
            await react(message)
        }
    }
    console.log('is we wehale',whale)
    const{time,result} = await promptAssist({...message,text: prompt ? prompt : message.text},true,false);
    lobby[userId].points += time+5;
    sendMessage(message,`\`${result}\``,{parse_mode: 'MarkdownV2'});
    setUserState(message,STATES.IDLE);
    delete workspace[userId]
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
        setUserState(message,STATES.INTERROGATE)
    } else {
        // if(lobby[message.from.id] && lobby[message.from.id].balance < 500000){
        //     gated(message)
        //     return
        // }
        //sendMessage(message, 'Send in the photo you want to watermark.',{reply_to_message_id: message.message_id})
        sendMessage(message, 'Send in the photo for interrogation')
        setUserState(message,STATES.INTERROGATE)
    }
    
}
async function shakeFluxInterrogate(message, image = null) {
    console.log('Starting flux interrogation...');
    react(message,'😇')
    const url = image || await getPhotoUrl(message)
    console.log('Got photo URL:', url);

    try {
        const result = await makeInterrogationRequest(url);
        if (result.error) {
            console.error('Interrogation failed:', result.error);
            // Send the quota-specific message if it exists
            sendMessage(message, result.error);
        } else {
            console.log('Interrogation successful:', result);
            sendMessage(message, result);
        }
    } catch (err) {
        console.error('Error during interrogation:', err);
        sendMessage(message, 'An error occurred during interrogation.');
    }

    setUserState(message, STATES.IDLE);
}

// Separated request logic
async function makeInterrogationRequest(url) {
    console.log('Making interrogation request for URL:', url);
    
    try {
        // Step 1: Get Event ID
        console.log('Getting event ID...');
        const eventId = await getEventId(url);
        console.log('Received event ID:', eventId);

        if (!eventId) {
            return { error: 'Failed to get event ID' };
        }

        // Step 2: Stream Result
        console.log('Streaming event result...');
        const result = await streamEventResult(eventId);
        console.log('Stream result received:', result);

        return result;

    } catch (error) {
        console.error('Request failed:', error);
        
        // Check for quota errors
        if (error.message.includes('quota') || error.message.includes('rate limit')) {
            const quotaMessage = await handleHuggingFaceQuota(error);
            if (quotaMessage) {
                return { error: quotaMessage };
            }
        }
        
        return { error: error.message };
    }
}

async function getEventId(url) {
    console.log('POST request to get event ID...');
    try {
        const response = await fetch('https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: [{ path: url }]
            })
        });

        console.log('Event ID response status:', response.status);
        console.log('Event ID response headers:', Object.fromEntries(response.headers));
        
        const jsonResponse = await response.json();
        console.log('Event ID raw response:', jsonResponse);

        const eventId = JSON.stringify(jsonResponse).split('"')[3];
        console.log('Extracted event ID:', eventId);
        return eventId;

    } catch (error) {
        console.error('Error getting event ID:', error);
        if (error.response) {
            console.log('Error response:', await error.response.text());
        }
        throw error;
    }
}

async function streamEventResult(eventId) {
    console.log('GET request to stream result for event:', eventId);
    const streamUrl = `https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat/${eventId}`;
    
    try {
        const response = await fetch(streamUrl, { method: 'GET' });
        console.log('Stream response status:', response.status);

        const result = await response.text();
        console.log('Raw stream response:', result);

        // Split into individual events
        const lines = result.split('\n');
        
        // Find the last data event that isn't null or heartbeat
        let lastDataLine = null;
        for (const line of lines) {
            if (line.startsWith('data:')) {
                const data = line.replace('data: ', '').trim();
                if (data !== 'null') {
                    lastDataLine = data;
                }
            }
        }

        if (!lastDataLine) {
            throw new Error('No valid data found in response');
        }

        const jsonData = JSON.parse(lastDataLine);
        console.log('Parsed JSON data:', jsonData);

        return jsonData[0];

    } catch (error) {
        console.error('Error streaming result:', error);
        if (error.response) {
            console.log('Error response:', await error.response.text());
        }
        throw error;
    }
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
    
    // Import voiceModels array
    
    // Find matching voice model
    const voiceModel = voiceModels.find(model => model.modelId === lobby[userId].voiceModel);
    
    if (!voiceModel) {
        sendMessage(message, 'Invalid voice model selected');
        return;
    }

    const result = await txt2Speech(message, lobby[userId].voiceModel, voiceModel.name, lobby[userId].customFileNames);
    
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

// Add this new function
async function handleHuggingFaceQuota(error) {
    // Extract wait time from error message using regex
    const waitTimeMatch = error.message.match(/retry in (\d+):(\d+):(\d+)/);
    if (waitTimeMatch) {
        const [_, hours, minutes, seconds] = waitTimeMatch;
        const totalMinutes = (parseInt(hours) * 60) + parseInt(minutes) + (parseInt(seconds) / 60);
        const waitMessage = `⏳ Service quota exceeded. Please try again in ${Math.ceil(totalMinutes)} minutes.`;
        return waitMessage;
    }
    
    // If we can't parse the wait time but it's a quota error
    if (error.message.includes('exceeded your GPU quota')) {
        return '⏳ Service quota exceeded. Please try again in 15 minutes.';
    }
    
    return null;
}

module.exports = {
    saySeed,
    sendLoRaModelFilenames, 
    loraList, featuredLoRaList,
    fluxLoraList,
    shakeAssist, shakeFluxAssist,
    shakeSpeak, startSpeak,
    handleHelp, handleStatus,
    seeGlorp,
    startFluxInterrogate,
    shakeFluxInterrogate
}