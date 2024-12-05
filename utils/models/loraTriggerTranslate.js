const { loraTriggers } = require('../bot/bot')
const { incrementLoraUseCounter } = require('../../db/mongodb')
const { checkpointmenu } = require('./checkpointmenu')

function handleLoraTrigger(prompt, checkpoint, balance) {
  // console.log('Starting handleLoraTrigger with:', {
  //   prompt,
  //   checkpoint,
  //   balance
  // });

  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  // Filter the loraTriggers array to only include LoRAs matching the checkpoint version
  const cleanCheckpoint = checkpoint.replace('.safetensors', '');
  const checkpointDesc = checkpointmenu.find(item => item.name === cleanCheckpoint)?.description;
  //console.log('Checkpoint description:', checkpointDesc);

  const filteredLoraTriggers = loraTriggers.filter(lora =>
    checkpoint && lora.version === checkpointDesc
  );
  //console.log(`Found ${filteredLoraTriggers.length} LoRAs matching checkpoint version`);

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
          checkpoint && lora.version == checkpointDesc &&
          !lora.disabled
        ) {
          usedLoras.add(lora.lora_name);
          //console.log(`Applying LoRA: ${lora.lora_name} with weight ${weight} for trigger word: ${triggerWord}`);
          return `<lora:${lora.lora_name}:${weight}> ${triggerWord}`;
        } else {
          // console.log(`Skipping LoRA: ${lora.lora_name} for trigger word: ${triggerWord}`, {
          //   alreadyUsed: usedLoras.has(lora.lora_name),
          //   wrongVersion: lora.version !== checkpointDesc,
          //   disabled: lora.disabled
          // });
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

  //console.log('Final prompt:', modifiedPrompt);
  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};