const fs = require('fs')
const path = require('path');
const { sendMessage, setUserState } = require('../../utils')
const { loraTriggers } = require('../../models/loraTriggerTranslate')

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
    let loraMessage = 'Here are the available LoRAs:\n\n';
  
    loraTriggers.forEach(lora => {
      const triggerWords = lora.triggerWords.join(', ');
      loraMessage += `Trigger Words: ${triggerWords}\n`;
      loraMessage += `Description: ${lora.description}\n`;
      loraMessage += `Civitai Link: ${lora.civitaiLink}\n\n`;
    });
  
    loraMessage += 'Use the listed trigger word to activate the LoRA in your prompt!';
  
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

    sendMessage(message, messagePart1)
      .then(() => {
        sendMessage(message, messagePart2)
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
    sendMessage(message, loraMessage)
      .then(() => {
        console.log(`Sent LoRA list to chatId ${chatId}.`);
      })
      .catch(error => {
        console.error(`Error sending LoRA list to chatId ${chatId}:`, error);
      });
  }
}

module.exports = { handleRequest, sendLoRaModelFilenames }