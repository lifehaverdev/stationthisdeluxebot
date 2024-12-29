const { Loras } = require('../../db/models/Loras');
const { checkpointmenu } = require('./checkpointmenu');
const { refreshLoraCache } = require('../../db/models/cache');

async function handleLoraTrigger(prompt, checkpoint, balance) {
  //onsole.log('handle lora trigger prompt checkpoint balance',prompt,checkpoint,balance)
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

  // Process words one at a time
  const words = prompt.split(/\s+/);
  let processedWords = new Set();
  let addedLoraTags = new Set(); // Track which LoRA tags we've already added

  for (const word of words) {
    const wordLower = word.toLowerCase();
    
    if (processedWords.has(wordLower)) continue;
    processedWords.add(wordLower);
    
    // Check cognates first
    const cognateMatch = cognates.get(wordLower);
    if (cognateMatch) {
      const loraTag = `<lora:${cognateMatch.lora_name}:${cognateMatch.weight}>`;
      
      // Only add the LoRA tag if we haven't used it yet
      if (!addedLoraTags.has(cognateMatch.lora_name)) {
        usedLoras.add(cognateMatch.lora_name);
        addedLoraTags.add(cognateMatch.lora_name);
        
        // Add the LoRA tag before the first occurrence of the word
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`(?<!<lora:[^>]*)(${word})`, 'i'),
          `${loraTag} ${cognateMatch.replaceWith}`
        );
      } else {
        // Just replace the word without adding another LoRA tag
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`(?<!<lora:[^>]*)(${word})`, 'gi'),
          cognateMatch.replaceWith
        );
      }

      await loraDB.incrementUses(cognateMatch.lora_name);
      continue;
    }

    // Check trigger words
    const triggerMatches = triggers.get(wordLower) || [];
    if (triggerMatches.length > 0) {
      console.log(`Found trigger word matches for "${word}":`, triggerMatches);
      const loraInfo = triggerMatches[0];
      const loraTag = `<lora:${loraInfo.lora_name}:${loraInfo.weight}>`;

      // Only add the LoRA tag if we haven't used it yet
      if (!addedLoraTags.has(loraInfo.lora_name)) {
        usedLoras.add(loraInfo.lora_name);
        addedLoraTags.add(loraInfo.lora_name);
        
        // Add the LoRA tag before the first occurrence of the word
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`(?<!<lora:[^>]*)(${word})`, 'i'),
          `${loraTag} $1`
        );
      }

      await loraDB.incrementUses(loraInfo.lora_name);
    }
  }

  console.log('\nFinal prompt:', modifiedPrompt);
  console.log('=== End LoRA Translation ===\n');

  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger
};