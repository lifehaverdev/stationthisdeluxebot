const { Loras } = require('../../db/models/loras');
const { checkpointmenu } = require('./checkpointmenu');
const { refreshLoraCache } = require('../../db/models/cache');

async function handleLoraTrigger(prompt, checkpoint, balance) {
  const loraDB = new Loras();
  let usedLoras = new Set();
  let addedLoraTags = new Set();
  let modifiedPrompt = prompt;

  console.log('\n=== LoRA Translation Process ===');
  //console.log('Input prompt:', prompt);
  //console.log('Checkpoint:', checkpoint);

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

   // Skip LoRA processing if no checkpoint description is found
   if (!checkpointDesc) {
    console.log('Warning: No checkpoint description found, skipping LoRA processing');
    return prompt;
  }

  // Get cached LoRA data
  const { triggers, cognates } = await refreshLoraCache(loraDB);
  // First pass: Check for multi-word triggers
  for (const [triggerKey, triggerMatches] of triggers) {
    if (triggerKey.includes(' ')) {  // Multi-word trigger
      const escapedTrigger = triggerKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const triggerRegex = new RegExp(`\\b${escapedTrigger}\\b`, 'i');
      
      if (triggerRegex.test(modifiedPrompt)) {
        const versionMatchedTriggers = triggerMatches.filter(trigger => 
          trigger.version === checkpointDesc
        );

        if (versionMatchedTriggers.length > 0) {
          const loraInfo = versionMatchedTriggers[0];
          const loraTag = `<lora:${loraInfo.lora_name}:${loraInfo.weight}>`;

          if (!addedLoraTags.has(loraInfo.lora_name)) {
            usedLoras.add(loraInfo.lora_name);
            addedLoraTags.add(loraInfo.lora_name);
            modifiedPrompt = modifiedPrompt.replace(triggerRegex, `${loraTag} ${triggerKey}`);
            await loraDB.incrementUses(loraInfo.lora_name);
          }
        }
      }
    }
  }
  // Process words one at a time
  // Split by whitespace but preserve punctuation for replacement
  //const words = prompt.split(/\s+/).map(word => word.trim());
  // Process words with potential punctuation
  const words = prompt.match(/[\w]+[.,!?()[\]{}'"]*|[.,!?()[\]{}'"]*[\w]+/g) || [];
  //console.log('Found words:', words); // Debug log

  let processedWords = new Set();

  for (const word of words) {
    // Skip if word is part of an existing LoRA tag
    if (/<lora:[^>]+>/.test(word)) continue;

    // Modified to only treat trailing numbers as weights if they follow a non-digit
    const weightMatch = word.match(/^(\d+|.*?(?:\d+)??)(?:(\d(?:\.\d+)?)|:(\d*\.?\d+))?[.,!?()[\]{}'"]*$/);
    if (!weightMatch) continue;
    // Strip punctuation for matching
    const wordLower = word.toLowerCase().replace(/[.,!?()[\]{}'"]/g, '');
    // console.log('\nProcessing word for cognates:', {
    //   original: word,
    //   lowercase: wordLower,
    //   checkpointDesc: checkpointDesc
    // });
    const [, baseWord, numericWeight, colonWeight] = weightMatch;
    const customWeight = colonWeight || numericWeight;
    
    // If the word is all digits and there's a numericWeight, treat the whole thing as the baseWord
    if (/^\d+$/.test(word) && numericWeight) {
        baseWord = word;
    }
    
    // Strip punctuation for matching
    //const wordLower = baseWord.toLowerCase().replace(/[.,!?()[\]{}'"]/g, '');
    
    if (processedWords.has(wordLower)) continue;
    processedWords.add(wordLower);
    
    // Check cognates first
    const cognateMatch = cognates.get(wordLower);
    // console.log('Cognate match:', {
    //   found: !!cognateMatch,
    //   matchDetails: cognateMatch,
    //   versionMatch: cognateMatch?.version === checkpointDesc
    // });
    if (cognateMatch && cognateMatch.version === checkpointDesc) {
      // console.log('Found valid cognate match:', {
      //   word: wordLower,
      //   loraName: cognateMatch.lora_name,
      //   version: cognateMatch.version,
      //   replaceWith: cognateMatch.replaceWith
      // });
      const weight = customWeight ? parseFloat(customWeight) / 10 : cognateMatch.weight;
      const loraTag = `<lora:${cognateMatch.lora_name}:${weight}>`;
      
      if (!addedLoraTags.has(cognateMatch.lora_name)) {
        usedLoras.add(cognateMatch.lora_name);
        addedLoraTags.add(cognateMatch.lora_name);
        
        // Enhanced regex to handle surrounding punctuation and ensure we're replacing the whole word
        modifiedPrompt = modifiedPrompt.replace(
          new RegExp(`\\b${wordLower}\\b`, 'i'),
          `${loraTag} ${cognateMatch.replaceWith}`
        );

        await loraDB.incrementUses(cognateMatch.lora_name);
        // console.log('Applied cognate replacement:', {
        //   from: wordLower,
        //   to: `${loraTag} ${cognateMatch.replaceWith}`,
        //   newPrompt: modifiedPrompt
        // });
      }
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