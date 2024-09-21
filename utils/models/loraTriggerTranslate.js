const { loraTriggers } = require('../bot/bot')
const { incrementLoraUseCounter } = require('../../db/mongodb')
const { checkpointmenu } = require('./checkpointmenu')

function handleLoraTrigger(prompt, checkpoint, balance) {
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  loraTriggers.forEach(lora => {
    lora.triggerWords.forEach(triggerWord => {
      const regex = new RegExp(`${triggerWord}(\\d*)`, 'gi');
      modifiedPrompt = modifiedPrompt.replace(regex, (match, p1) => {
        const weight = p1 ? (parseInt(p1, 10) / 10).toFixed(1) : lora.default_weight;
        if (
          !usedLoras.has(lora.lora_name) && 
          (lora.gate <= balance) && 
          checkpoint && lora.version == checkpointmenu.find(item => item.name === checkpoint)?.description &&
          !lora.disabled
        ) {
          usedLoras.add(lora.lora_name);
          return `<lora:${lora.lora_name}:${weight}> ${triggerWord}`;
        } else {
          return triggerWord; // Avoid adding the LoRA syntax again if it's already used or if gatekept or if wrong basemodel
        }
      });
    });
  });
    // Convert the Set to an Array and increment the use counter for the used LoRAs
    const usedLoraNamesArray = Array.from(usedLoras);
    if (usedLoraNamesArray.length > 0) {
      incrementLoraUseCounter(usedLoraNamesArray); // Call the function to increment 'uses'
    }
  console.log('before & after', prompt, modifiedPrompt)
  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};