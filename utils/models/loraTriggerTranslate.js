const { Loras } = require('../../db/models/Loras');
const { checkpointmenu } = require('./checkpointmenu');
const { refreshLoraCache } = require('../../db/models/cache');

async function handleLoraTrigger(prompt, checkpoint, balance) {
  const loraDB = new Loras();
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  console.log('\n=== LoRA Translation Process ===');
  console.log('Input prompt:', prompt);
  console.log('Checkpoint:', checkpoint);

  // Get checkpoint version for filtering
  const cleanCheckpoint = checkpoint.replace('.safetensors', '');
  const checkpointDesc = checkpointmenu.find(item => item.name === cleanCheckpoint)?.description;
  console.log('Checkpoint description:', checkpointDesc);

  // Get cached LoRA data
  const { triggers, cognates } = await refreshLoraCache(loraDB);

  // Debug: Check what's in triggers
  console.log('\nAvailable triggers:');
  for (const [word, loraInfos] of triggers) {
    console.log(`Word "${word}" triggers:`, loraInfos.map(info => info.lora_name));
  }

  // Split prompt into words and process each one
  const words = prompt.split(/\s+/);
  console.log('\nProcessing words:', words);

  for (const word of words) {
    const wordLower = word.toLowerCase();
    
    // Check cognates first
    const cognateMatch = cognates.get(wordLower);
    if (cognateMatch) {
      console.log(`Found cognate match for "${word}":`, cognateMatch);
      usedLoras.add(cognateMatch.lora_name);

      modifiedPrompt = modifiedPrompt.replace(
        new RegExp(`(${word})`, 'gi'), 
        `<lora:${cognateMatch.lora_name}:${cognateMatch.weight}> ${cognateMatch.replaceWith}`
      );

      await loraDB.incrementUses(cognateMatch.lora_name);
      continue;
    }

    // Check trigger words
    const triggerMatches = triggers.get(wordLower) || [];
    if (triggerMatches.length > 0) {
        console.log(`Found trigger word matches for "${word}":`, triggerMatches);
        const loraInfo = triggerMatches[0]; // Use first matching LoRA
        usedLoras.add(loraInfo.lora_name);

        modifiedPrompt = modifiedPrompt.replace(
            new RegExp(`(${word})`, 'gi'),
            `<lora:${loraInfo.lora_name}:${loraInfo.weight}> $1`
        );

        await loraDB.incrementUses(loraInfo.lora_name);
        continue;
    }
  }

  console.log('\nFinal prompt:', modifiedPrompt);
  console.log('=== End LoRA Translation ===\n');

  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger
};