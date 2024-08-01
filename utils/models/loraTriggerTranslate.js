const { loraTriggers } = require('../bot/bot')

function handleLoraTrigger(prompt, balance) {
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  loraTriggers.forEach(lora => {
    lora.triggerWords.forEach(triggerWord => {
      const regex = new RegExp(`${triggerWord}(\\d*)`, 'gi');
      modifiedPrompt = modifiedPrompt.replace(regex, (match, p1) => {
        const weight = p1 ? (parseInt(p1, 10) / 10).toFixed(1) : lora.default_weight;
        if (!usedLoras.has(lora.lora_name) && (lora.gate <= balance)) {
          usedLoras.add(lora.lora_name);
          return `<lora:${lora.lora_name}:${weight}> ${triggerWord}`;
        } else {
          return triggerWord; // Avoid adding the LoRA syntax again if it's already used
        }
      });
    });
  });
  console.log('before & after', prompt, modifiedPrompt)
  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};