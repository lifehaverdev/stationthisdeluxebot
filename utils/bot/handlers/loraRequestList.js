const fs = require('fs')
const path = require('path');
const { sendMessage, setUserState } = require('../../utils')
const { loraTriggers } = require('../../models/loraTriggerTranslate')
const { checkpointmenu } = require('../../models/checkpointmenu')
const { lobby } = require('../bot')

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

// async function sendLoRaModelFilenames(message) {
//     const chatId = message.chat.id;
//     let loraMessage = 'Here are the available LoRAs:\n\n';
  
//     loraTriggers.forEach(lora => {
//       const triggerWords = lora.triggerWords.join(', ');
//       loraMessage += `Trigger Words: ${triggerWords}\n`;
//       loraMessage += `Description: ${lora.description}\n`;
//       loraMessage += `Civitai Link: ${lora.civitaiLink}\n\n`;
//     });
  
//     loraMessage += 'Use the listed trigger word to activate the LoRA in your prompt!';
  
//     const maxMessageLength = 4096; // Telegram's max message length is 4096 characters
//   if (loraMessage.length > maxMessageLength) {
//     const midpoint = Math.floor(loraMessage.length / 2);
//     let splitIndex = midpoint;
    
//     // Ensure we split at a sensible point (e.g., end of a line)
//     while (splitIndex > 0 && loraMessage[splitIndex] !== '\n') {
//       splitIndex--;
//     }

//     const messagePart1 = loraMessage.substring(0, splitIndex);
//     const messagePart2 = loraMessage.substring(splitIndex);

//     sendMessage(message, messagePart1)
//       .then(() => {
//         sendMessage(message, messagePart2)
//           .then(() => {
//             console.log(`Sent split LoRA list to chatId ${chatId}.`);
//           })
//           .catch(error => {
//             console.error(`Error sending second part of LoRA list to chatId ${chatId}:`, error);
//           });
//       })
//       .catch(error => {
//         console.error(`Error sending first part of LoRA list to chatId ${chatId}:`, error);
//       });
//   } else {
//     sendMessage(message, loraMessage)
//       .then(() => {
//         console.log(`Sent LoRA list to chatId ${chatId}.`);
//       })
//       .catch(error => {
//         console.error(`Error sending LoRA list to chatId ${chatId}:`, error);
//       });
//   }
// }

async function sendLoRaModelFilenames(message) {
  const chatId = message.chat.id;
  let loraMessage = 'Loras:\n\n';

  const checkpointName = lobby[message.from.id]?.checkpoint;
  console.log(checkpointName);
  // const checkpointDescriptions = {
  //     "SD1.5": true,
  //     "SDXL": true,
  //     "SD3": true
  // };
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
    //console.log(lora.version);
    //console.log(checkpointDescription == lora.version);
      if (checkpointName && checkpointDescription == lora.version && lobby[message.from.id].balance >= lora.gate) {
          const triggerWords = lora.triggerWords.join(', ');
          const loraInfo = `\`${triggerWords}\``;
          const featureInfo = `${lora.description}\nTrigger Words: \`${triggerWords}\`\nToken Gate: ${lora.gate}\n`;

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


module.exports = { handleRequest, sendLoRaModelFilenames }