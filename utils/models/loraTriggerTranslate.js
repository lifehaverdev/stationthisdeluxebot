const { Loras } = require('../../db/models/loras');
const { checkpointmenu } = require('./checkpointmenu');
const { refreshLoraCache } = require('../../db/models/cache');

async function handleLoraTrigger(prompt, checkpoint, balance) {
  //onsole.log('handle lora trigger prompt checkpoint balance',prompt,checkpoint,balance)
  const loraDB = new Loras();
  let usedLoras = new Set();
  let addedLoraTags = new Set();
  let modifiedPrompt = prompt;

  console.log('\n=== LoRA Translation Process ===');
  console.log('Input prompt:', prompt);
  console.log('Checkpoint:', checkpoint);

  // Pre-scan for existing LoRA tags
  const existingLoraTags = prompt.match(/<lora:([^:]+):[^>]+>/g) || [];
  for (const tag of existingLoraTags) {
    const loraName = tag.match(/<lora:([^:]+):/)?.[1];
    if (loraName) {
      usedLoras.add(loraName);
      addedLoraTags.add(loraName);
    }
  }

  // Get checkpoint version for filtering
  const cleanCheckpoint = checkpoint.replace('.safetensors', '');
  const checkpointDesc = checkpointmenu.find(item => item.name === cleanCheckpoint)?.description;
  console.log('Checkpoint description:', checkpointDesc);

   // Skip LoRA processing if no checkpoint description is found
   if (!checkpointDesc) {
    console.log('Warning: No checkpoint description found, skipping LoRA processing');
    return prompt;
  }

  // Get cached LoRA data
  const { triggers, cognates } = await refreshLoraCache(loraDB);

  // Process words one at a time
  // Split by whitespace but preserve punctuation for replacement
  const words = prompt.split(/\s+/).map(word => word.trim());
  let processedWords = new Set();

  for (const word of words) {
    // Skip if word is part of an existing LoRA tag
    if (/<lora:[^>]+>/.test(word)) continue;

    // Check for weight syntax: either number suffix or :number
    const weightMatch = word.match(/^(.*?)(?:(\d(?:\.\d+)?)|:(\d*\.?\d+))?[.,!?()[\]{}'"]*$/);
    if (!weightMatch) continue;

    const [, baseWord, numericWeight, colonWeight] = weightMatch;
    const customWeight = colonWeight || numericWeight;
    
    // Strip punctuation for matching
    const wordLower = baseWord.toLowerCase().replace(/[.,!?()[\]{}'"]/g, '');
    
    if (processedWords.has(wordLower)) continue;
    processedWords.add(wordLower);
    
    // Check cognates first
    const cognateMatch = cognates.get(wordLower);
    if (cognateMatch && cognateMatch.version === checkpointDesc) {
      const weight = customWeight ? parseFloat(customWeight) / 10 : cognateMatch.weight;
      const loraTag = `<lora:${cognateMatch.lora_name}:${weight}>`;
      
      if (!addedLoraTags.has(cognateMatch.lora_name)) {
        usedLoras.add(cognateMatch.lora_name);
        addedLoraTags.add(cognateMatch.lora_name);
        
        // Use word boundary and optional punctuation in regex
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`(?<!<lora:[^>]*)\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
          `${loraTag} ${cognateMatch.replaceWith}`
        );
      } else {
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`(?<!<lora:[^>]*)\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
          cognateMatch.replaceWith
        );
      }

      await loraDB.incrementUses(cognateMatch.lora_name);
      continue;
    }

    // Check trigger words
    const triggerMatches = triggers.get(wordLower) || [];
    if (triggerMatches.length > 0) {
      // Filter matches by version and take the first match
      const versionMatchedTriggers = triggerMatches.filter(trigger => trigger.version === checkpointDesc);
      if (versionMatchedTriggers.length > 0) {
        console.log(`Found trigger word matches for "${word}":`, triggerMatches);
        const loraInfo = versionMatchedTriggers[0];
        const weight = customWeight ? parseFloat(customWeight) / 10 : loraInfo.weight;
        const loraTag = `<lora:${loraInfo.lora_name}:${weight}>`;

        if (!addedLoraTags.has(loraInfo.lora_name)) {
          usedLoras.add(loraInfo.lora_name);
          addedLoraTags.add(loraInfo.lora_name);
          
          // Clean up the trigger word by removing weight syntax
          const cleanWord = baseWord.replace(/(?:\d+(?:\.\d+)?|:\d*\.?\d+)$/, '');
          const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          modifiedPrompt = modifiedPrompt.replace(
            new RegExp(`(?<!<lora:[^>]*)${escapedWord}`, 'i'),
            `${loraTag} ${cleanWord}`
          );
        }

        await loraDB.incrementUses(loraInfo.lora_name);
      } else {
        console.log(`No trigger word matches found for "${word}" with checkpoint version ${checkpointDesc}`);
      }
    }
  }

  console.log('\nFinal prompt:', modifiedPrompt);
  console.log('=== End LoRA Translation ===\n');

  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger
};