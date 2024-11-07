const { loraTriggers } = require('../bot/bot')
const { incrementLoraUseCounter } = require('../../db/mongodb')
const { checkpointmenu } = require('./checkpointmenu')

function handleLoraTrigger(prompt, checkpoint, balance) {
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  // Filter the loraTriggers array to only include LoRAs matching the checkpoint version
  const filteredLoraTriggers = loraTriggers.filter(lora =>
    checkpoint && lora.version === checkpointmenu.find(item => item.name === checkpoint)?.description
  );
  filteredLoraTriggers.forEach(lora => {
    lora.triggerWords.forEach(triggerWord => {
      const regex = new RegExp(`${triggerWord}(\\d*)`, 'gi');
      modifiedPrompt = modifiedPrompt.replace(regex, (match, p1) => {
        let weight;
        // If p1 is provided, determine the weight based on its value
        if (p1) {
          const p1Value = parseInt(p1, 10);

          // If p1Value > 10, allow weights greater than 1 (for example, 12 -> 1.2, 14 -> 1.4, etc.)
          weight = p1Value > 10 ? (p1Value / 10).toFixed(1) : (p1Value / 10).toFixed(1);
        } else {
          // Use the default weight if no p1 is provided
          weight = lora.default_weight;
        }
        if (
          !usedLoras.has(lora.lora_name) && 
          //(lora.gate <= balance) && 
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
  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};