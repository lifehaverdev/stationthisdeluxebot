const { loraTriggers } = require('../bot/bot')
const { incrementLoraUseCounter } = require('../../db/mongodb')
const { checkpointmenu } = require('./checkpointmenu')

function handleLoraTrigger(prompt, checkpoint, balance) {
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  // First, check for existing LoRA tags and extract them
  const existingLoraRegex = /<lora:([^:>]+)(?::[^>]+)?>/g;
  const existingLoras = [...prompt.matchAll(existingLoraRegex)].map(match => match[1]);
  existingLoras.forEach(lora => usedLoras.add(lora));

  // Filter the loraTriggers array to only include LoRAs matching the checkpoint version
  const cleanCheckpoint = checkpoint.replace('.safetensors', '');
  const checkpointDesc = checkpointmenu.find(item => item.name === cleanCheckpoint)?.description;

  const filteredLoraTriggers = loraTriggers.filter(lora =>
    checkpoint && lora.version === checkpointDesc
  );

  filteredLoraTriggers.forEach(lora => {
    lora.triggerWords.forEach(triggerWord => {
      const regex = new RegExp(`${triggerWord}(\\d*)`, 'gi');
      modifiedPrompt = modifiedPrompt.replace(regex, (match, p1) => {
        let weight;
        if (p1) {
          const p1Value = parseInt(p1, 10);
          weight = p1Value > 10 ? (p1Value / 10).toFixed(1) : (p1Value / 10).toFixed(1);
        } else {
          weight = lora.default_weight;
        }
        
        // Check if this LoRA has already been used or is already in the prompt
        if (
          !usedLoras.has(lora.lora_name) && 
          checkpoint && 
          lora.version == checkpointDesc &&
          !lora.disabled
        ) {
          usedLoras.add(lora.lora_name);
          return `<lora:${lora.lora_name}:${weight}> ${triggerWord}`;
        } else {
          // If LoRA is already used, just return the trigger word without the LoRA tag
          return triggerWord;
        }
      });
    });
  });

  // Convert the Set to an Array and increment the use counter for the used LoRAs
  const usedLoraNamesArray = Array.from(usedLoras);
  if (usedLoraNamesArray.length > 0) {
    console.log('Used LoRAs:', usedLoraNamesArray);
    incrementLoraUseCounter(usedLoraNamesArray);
  } else {
    console.log('No LoRAs were applied to the prompt');
  }

  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};