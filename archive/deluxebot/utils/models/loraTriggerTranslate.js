const { Loras } = require('../../db/models/loras');
const { checkpointmenu } = require('./checkpointmenu');
const { refreshLoraCache } = require('../../db/models/cache');

// Extract existing LoRA tags from prompt
function extractExistingLoraTags(prompt) {
  const usedLoras = new Set();
  const addedLoraTags = new Set();
  const existingLoraTags = prompt.match(/<lora:([^:]+):[^>]+>/g) || [];
  
  for (const tag of existingLoraTags) {
    const loraName = tag.match(/<lora:([^:]+):/)?.[1];
    if (loraName) {
      usedLoras.add(loraName);
      addedLoraTags.add(loraName);
    }
  }
  
  return { usedLoras, addedLoraTags };
}

// Get checkpoint version and validate
function getCheckpointVersion(checkpoint) {
  const cleanCheckpoint = checkpoint.replace('.safetensors', '');
  const checkpointDesc = checkpointmenu.find(item => item.name === cleanCheckpoint)?.description;
  
  if (!checkpointDesc) {
    console.log('Warning: No checkpoint description found, skipping LoRA processing');
  }
  
  return checkpointDesc;
}

async function processMultiWordTriggers(prompt, triggers, cognates, checkpointDesc, addedLoraTags, usedLoras, loraDB) {
  let modifiedPrompt = prompt;
  
  // Process multi-word triggers
  for (const [triggerKey, triggerMatches] of triggers) {
    if (!triggerKey.includes(' ')) continue;  // Skip single-word triggers
    
    const escapedTrigger = triggerKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const triggerRegex = new RegExp(`\\b${escapedTrigger}(?::(\\d*\\.?\\d+))?`, 'i');

    const match = modifiedPrompt.match(triggerRegex);
    
    if (match) {
      

      const weight = match[1] ? parseFloat(match[1]) : undefined;  // Get weight if present
      
      const loraInfo = {
        ...triggerMatches[0],
        customWeight: weight  // Pass the weight to applyLoraTag
      };
      
      const { modifiedText, loraName } = await applyLoraTag(
        modifiedPrompt,
        triggerKey,
        loraInfo,
        addedLoraTags,
        usedLoras,
        loraDB
      );
      modifiedPrompt = modifiedText;
      
    }
  }

    // Process multi-word cognates
    for (const [cognateKey, cognateInfo] of cognates) {
      if (!cognateKey.includes(' ')) continue;  // Skip single-word cognates
      
      const escapedCognate = cognateKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cognateRegex = new RegExp(`\\b${escapedCognate}(?::(\d*\.?\d+))?\\b`, 'i');
      const match = modifiedPrompt.match(cognateRegex);
      
      if (match) {
        const weight = match[1] ? parseFloat(match[1]) : undefined;  // Match trigger handling
        
        const loraInfo = {
          ...cognateInfo,
          customWeight: weight  // Match trigger handling
        };
        
        const { modifiedText, loraName } = await applyLoraTag(
          modifiedPrompt,
          cognateKey,
          loraInfo,
          addedLoraTags,
          usedLoras,
          loraDB
        );
        modifiedPrompt = modifiedText;
      }
    }
  
  return modifiedPrompt;
}

// Parse word and extract weight
function parseWordAndWeight(word) {
  const weightMatch = word.match(/^(.*?)(?::(\d*\.?\d+))?[.,!?()[\]{}'"]*$/);
  
  if (!weightMatch) return null;
  
  const [, baseWord, weight] = weightMatch;
  const result = {
    baseWord: baseWord.trim(),
    weight: weight ? parseFloat(weight) : null,
    wordLower: baseWord.toLowerCase().trim().replace(/[.,!?()[\]{}'"]/g, '')
  };
  
  return result;
}

async function applyLoraTag(text, originalWord, loraInfo, addedLoraTags, usedLoras, loraDB) {
  const weight = loraInfo.customWeight || loraInfo.weight;
  
  const loraTag = `<lora:${loraInfo.lora_name}:${weight}>`;
  
  if (!addedLoraTags.has(loraInfo.lora_name)) {
    usedLoras.add(loraInfo.lora_name);
    addedLoraTags.add(loraInfo.lora_name);
    
    // Match the full pattern including weight if present
    const escapedWord = originalWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = loraInfo.replaceWith || originalWord;
    const modifiedText = text.replace(
      new RegExp(`(?<!<lora:[^>]*)\\b${escapedWord}(?::\\d*\\.?\\d+)?\\b`, 'i'),
      `${loraTag} ${replacement}`
    );
    
    await loraDB.incrementUses(loraInfo.lora_name);
    return { modifiedText, loraName: loraInfo.lora_name };
  }
  
  return { modifiedText: text, loraName: null };
}

async function handleLoraTrigger(prompt, checkpoint, balance) {
  const loraDB = new Loras();
  let modifiedPrompt = prompt;

  console.log('\n=== LoRA Translation Process ===');

  // Extract existing tags and initialize tracking sets
  const { usedLoras, addedLoraTags } = extractExistingLoraTags(prompt);
  
  // Validate checkpoint
  const checkpointDesc = getCheckpointVersion(checkpoint);
  if (!checkpointDesc) return prompt;
  

  // Get cached LoRA data
  // Get cached LoRA data and filter by checkpoint version
  const { triggers: allTriggers, cognates: allCognates } = await refreshLoraCache(loraDB);

  // Filter triggers Map
  const triggers = new Map(
    Array.from(allTriggers).map(([key, triggerList]) => [
      key,
      triggerList.filter(trigger => trigger.version === checkpointDesc)
    ]).filter(([_, triggerList]) => triggerList.length > 0)
  );

  // Filter cognates Map
  const cognates = new Map(
    Array.from(allCognates).filter(([_, cognate]) => 
      cognate.version === checkpointDesc
    )
  );

  // Process multi-word triggers first
  modifiedPrompt = await processMultiWordTriggers(
    modifiedPrompt,
    triggers,
    cognates,
    checkpointDesc,
    addedLoraTags,
    usedLoras,
    loraDB
  );
  
  // Change the word splitting regex to keep weights attached
  const words = modifiedPrompt.match(/\b[\w]+(?::\d*\.?\d+)?[.,!?()[\]{}'"]*\b|\b[.,!?()[\]{}'"]*[\w]+(?::\d*\.?\d+)?\b/g) || [];
  let processedWords = new Set();

  for (const word of words) {
    if (/<lora:[^>]+>/.test(word)) continue;

    const parsedWord = parseWordAndWeight(word);
    if (!parsedWord) continue;
    
    const { baseWord, weight, wordLower } = parsedWord;
    if (processedWords.has(wordLower)) continue;
    processedWords.add(wordLower);

    // Process cognates
    const cognateMatch = cognates.get(wordLower);
    if (cognateMatch?.version === checkpointDesc) {
      const loraInfo = {
        ...cognateMatch,
        customWeight: weight,
        replaceWith: cognateMatch.replaceWith
      };
      const result = await applyLoraTag(
        modifiedPrompt,
        wordLower,
        loraInfo,
        addedLoraTags,
        usedLoras,
        loraDB
      );
      modifiedPrompt = result.modifiedText;
      continue;
    }

    // Process trigger words
    const triggerMatches = triggers.get(wordLower) || [];
    const versionMatchedTriggers = triggerMatches.filter(
      trigger => trigger.version === checkpointDesc
    );

    if (versionMatchedTriggers.length > 0) {
      const loraInfo = {
        ...versionMatchedTriggers[0],
        customWeight: weight
      };
      const result = await applyLoraTag(
        modifiedPrompt,
        baseWord,
        loraInfo,
        addedLoraTags,
        usedLoras,
        loraDB
      );
      modifiedPrompt = result.modifiedText;
    }
  }

  //console.log('\nFinal prompt:', modifiedPrompt);
  console.log('=== End LoRA Translation ===\n');

  return modifiedPrompt;
}

module.exports = {
  handleLoraTrigger
};