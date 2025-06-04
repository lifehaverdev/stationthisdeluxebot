const { ObjectId } = require('mongodb');
const { fetchLegacyLoraData } = require('./examineLoraData');

/**
 * Safely converts an input to a MongoDB ObjectId.
 * If the input is not a valid 24-character hex string, returns null and logs a warning.
 */
function toObjectIdSafe(idInput) {
  if (idInput === null || typeof idInput === 'undefined') return null;

  const idString = String(idInput);

  if (/^[0-9a-fA-F]{24}$/.test(idString)) {
    try {
      return new ObjectId(idString);
    } catch (e) {
      console.warn(`⚠️ Failed to convert presumed valid ObjectId string '${idString}' to ObjectId: ${e.message}. Field will be null.`);
      return null;
    }
  } else {
    console.warn(`⚠️ Legacy ID '${idString}' is not a 24-char hex ObjectId string. Cannot directly convert. Field will be null.`);
    return null;
  }
}

/**
 * LoRA Migration Transformer (v2)
 * Transforms legacy LoRA model + training records into structured schema with triggerWords, cognates, and safety filters.
 */

// Words too risky to use as trigger words
const BLACKLISTED_TRIGGERS = ['and', 'or', 'but', 'a', 'the', 'in', 'on', 'is', 'are', 'it', 'this','#'];

/**
 * Check if trigger word is unsafe
 */
function isUnsafeTrigger(trigger) {
  return (
    !trigger ||
    typeof trigger !== 'string' ||
    BLACKLISTED_TRIGGERS.includes(trigger.trim().toLowerCase())
  );
}

/**
 * Sanitize a single trigger word
 */
function sanitizeTrigger(trigger) {
    if (typeof trigger !== 'string') return '';
    return trigger.trim().toLowerCase().replace(/\s+/g, '_');
  }
  

/**
 * Normalize a LoRA model name
 */
function normalizeModelName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
* Transform a legacy LoRA model into new schema
*/
function transformLoraModel(legacyLora) {
 // Normalize and sanitize trigger words
 const rawTriggers = legacyLora.triggerWords || [legacyLora.triggerWord] || [];
 const allTriggers = Array.isArray(rawTriggers) ? rawTriggers : [rawTriggers];

 const safeTriggers = allTriggers
   .map(trigger => {
     if (typeof trigger !== 'string') {
       console.warn(`⚠️ Invalid trigger type found in "${legacyLora.lora_name || 'unnamed LoRA'}":`, trigger);
       return '';
     }
     return sanitizeTrigger(trigger);
   })
   .filter(trigger => !isUnsafeTrigger(trigger) && trigger.length > 0);

 if (safeTriggers.length === 0 && !(legacyLora.lora_name || legacyLora.modelId || '').includes('unnamed_lora')) { // Allow unnamed if no triggers
   console.warn(`⚠️ Skipping LoRA "${legacyLora.lora_name || 'unnamed LoRA'}" due to no safe trigger words.`);
   return null;
 }

  // modelName must be defined before it's used in safeCognates mapping
  const modelName = normalizeModelName(legacyLora.lora_name);

 // Normalize and sanitize cognates
 const cognatesRaw = Array.isArray(legacyLora.cognates) ? legacyLora.cognates : [];
 const safeCognates = cognatesRaw
   .map(cognate => {
     let word = '';
     let replaceWith = '';
 
     if (typeof cognate === 'string') {
       word = sanitizeTrigger(cognate);
       replaceWith = safeTriggers[0] || ''; // fallback to first triggerWord
     } else if (
       typeof cognate === 'object' &&
       cognate !== null &&
       typeof cognate.word === 'string'
     ) {
       word = sanitizeTrigger(cognate.word);
       replaceWith = sanitizeTrigger(cognate.replaceWith || safeTriggers[0] || '');
     } else {
       console.warn(`⚠️ Invalid cognate in "${legacyLora.lora_name || 'unnamed LoRA'}":`, cognate);
       return null;
     }
 
     if (isUnsafeTrigger(word) || !replaceWith || safeTriggers.includes(word)) return null;
     return { word, replaceWith };
   })
   .filter(Boolean);
 

 const displayName = legacyLora.lora_name || 'Untitled LoRA'; // Keep for potential use, though 'name' is primary

  // Process existing legacy tags
  let processedTags = (Array.isArray(legacyLora.tags)
    ? legacyLora.tags.map(tagInput => ({ tag: sanitizeTrigger(typeof tagInput === 'string' ? tagInput : String(tagInput)), source: 'user', score: 1 }))
    : typeof legacyLora.tags === 'string'
    ? [{ tag: sanitizeTrigger(legacyLora.tags), source: 'user', score: 1 }]
    : []).filter(t => t.tag && t.tag.length > 0); // Ensure tag is not empty and has length

  // Determine the modelType value that will be used for the modelType field
  const modelTypeForTagging = legacyLora.type || 'style'; // Matches the logic for the actual modelType field
  const sanitizedModelTypeAsTag = sanitizeTrigger(modelTypeForTagging);

  // Add the modelType as a tag if it's valid and not already present
  if (sanitizedModelTypeAsTag && sanitizedModelTypeAsTag.length > 0) {
    const modelTypeTagObject = { tag: sanitizedModelTypeAsTag, source: 'user', score: 1 };
    if (!processedTags.some(existingTag => existingTag.tag === sanitizedModelTypeAsTag)) {
      processedTags.push(modelTypeTagObject);
    }
  }

 return {
   _id: new ObjectId(),
   slug: modelName,
   name: modelName, // Changed from loraName, uses displayName's previous logic essentially
   // displayName: displayName, // Removed as 'name' should be canonical. Kept var above if needed elsewhere.
   triggerWords: safeTriggers,
   cognates: safeCognates, // This field is not in loRAModelDb.js schema
   defaultWeight: parseFloat(legacyLora.default_weight || 1.0),
   version: "v1.0", // Not in loRAModelDb.js, but kept from user request set to 0 to indicate migrated 
   modelType: legacyLora.type || 'style',
   strength: 'medium', // fallback
   checkpoint: legacyLora.version, // or infer from version/type if possible

   createdBy: toObjectIdSafe(legacyLora.userId), // Ensure this is an ObjectId or null
   ownedBy: toObjectIdSafe(legacyLora.userId),   // Ensure this is an ObjectId or null

   visibility: legacyLora.hidden ? 'private' : 'public', // loRAModelDb allows 'unlisted'
   permissionType: legacyLora.gate > 0 ? 'licensed' : 'public', // loRAModelDb allows 'private'

   monetization: legacyLora.gate > 0
    ? { priceUSD: parseFloat(legacyLora.gate), forSale: true }
    : undefined,

   tags: processedTags,
    
   description: legacyLora.description || '',
   examplePrompts: legacyLora.examplePrompt ? (Array.isArray(legacyLora.examplePrompt) ? legacyLora.examplePrompt : [legacyLora.examplePrompt]) : [],
   previewImages: legacyLora.exampleImagePath ? (Array.isArray(legacyLora.exampleImagePath) ? legacyLora.exampleImagePath : [legacyLora.exampleImagePath]) : [],
   usageCount: legacyLora.uses || 0,
   rating: { avg: legacyLora.rating || 0, count: (legacyLora.ratings && Array.isArray(legacyLora.ratings) ? legacyLora.ratings : []).length },
   disabled: !!legacyLora.disabled, // Not in loRAModelDb.js, moderation block is different
   
   importedFrom: legacyLora.civitaiLink 
    ? { source: 'civitai', url: legacyLora.civitaiLink, importedAt: new Date() } 
    : undefined,
   // Removed civitaiLink as it's now in importedFrom

   createdAt: legacyLora.addedDate
     ? new Date(Number(legacyLora.addedDate))
     : new Date(),
 };
}


/**
 * Transform a legacy training record
 */
function transformTrainingJob(training, loraIdMap, loraModels) {
  const now = new Date();
  const masterAccountId = new ObjectId('681a27d761a6acd963d084dd'); // Use provided masterAccountId
  // TODO: In a future version, map legacy userId to new masterAccountId to track ownership correctly.
  const linkedLoraModelId = loraIdMap.get(training.loraKey) || null;

  let preferredTriggerWord = '';
  if (linkedLoraModelId) {
    const linkedModel = loraModels.find(m => m._id.equals(linkedLoraModelId));
    if (linkedModel && linkedModel.triggerWords && linkedModel.triggerWords.length > 0) {
      preferredTriggerWord = linkedModel.triggerWords[0];
    }
  }

  // Caption Set
  const defaultCaptionSetId = new ObjectId().toString();
  const captionSets = [
    {
      _id: defaultCaptionSetId,
      name: 'Default Migrated Captions',
      captions: training.captions || [],
      createdAt: training.initiated ? new Date(Number(training.initiated)) : now,
    }
  ];

  // Training Run
  const trainingRunStatus = (training.status === 'TOUCHED' || training.status === 'completed') ? 'complete' : 'failed'; // Basic status mapping
  const trainingRuns = [
    {
      _id: new ObjectId().toString(),
      tool: training.tool?.toString() || 'migrated_tool',
      modelType: training.trainingType || 'style', // Assuming trainingType maps to modelType
      checkpoint: training.version || 'SDXL', // Assuming legacy version maps to checkpoint
      steps: parseInt(training.iter, 10) || 0,
      captionSetId: defaultCaptionSetId,
      outputLoRAId: linkedLoraModelId,
      status: trainingRunStatus,
      trainedAt: training.completedAt ? new Date(Number(training.completedAt)) : (trainingRunStatus === 'complete' ? now : null),
    }
  ];

  let notes = training.notes || '';
  if (training.prompt) {
    notes += `\nOriginal Prompt: ${training.prompt}`;
  }
  if (training.label) {
    notes += `\nLegacy Label: ${training.label}`;
  }

  let jobStatus = 'draft';
  if (training.status === 'TOUCHED' || training.status === 'completed') {
    jobStatus = 'complete';
  } else if (training.status === 'failed' || training.status === 'error') { // Assuming some error states
    jobStatus = 'failed';
  } else if (training.status === 'submitted' || training.status === 'queued' || training.status === 'training') {
    jobStatus = training.status; // If it matches new statuses
  }

  return {
    _id: new ObjectId(),
    name: training.name || 'Migrated Training Session',
    masterAccountId: masterAccountId, // Use provided masterAccountId
    ownedBy: masterAccountId, // Default ownership to masterAccountId
    // collectionId: undefined, // No direct mapping, can be added later
    images: training.images || [], // Kept as strings, will be remapped to ObjectIds later by remapTrainingImageRefs
    captionSets: captionSets,
    trainingRuns: trainingRuns,
    status: jobStatus,
    preferredTrigger: preferredTriggerWord,
    tags: [], // No direct mapping for tags from legacy training
    allowPublishing: true, // Defaulting to true
    notes: notes.trim() || null,
    createdAt: training.initiated ? new Date(Number(training.initiated)) : now,
    updatedAt: now,
    submittedAt: training.submitted ? new Date(Number(training.submitted)) : null,
    completedAt: training.completedAt ? new Date(Number(training.completedAt)) : (jobStatus === 'complete' ? now : null),
    // Fields from old structure to remove or ensure they are not directly copied if not needed:
    // ownerMasterId: training.userId?.toString() || null, (replaced by masterAccountId, ownedBy)
    // trainingData: { imageUrls, notes } (replaced by top-level images, notes)
    // startedAt: (replaced by createdAt)
    // linkedLoraModelId: (now in trainingRuns[0].outputLoRAId)
    // metadata: { originalPrompt, label } (info moved to notes)
  };
}

/**
 * Main transformation function
 */
async function transformLegacyLoras() {
  const { loraRaw, trainingRaw } = await fetchLegacyLoraData();

  const loraModels = [];
  const loraIdMap = new Map();

  for (const legacyLora of loraRaw) {
    const transformed = transformLoraModel(legacyLora);
    if (transformed) {
      loraModels.push(transformed);
      // Use the string version of ObjectId for the map key if legacyLora.lora_name or modelId is not reliable
      loraIdMap.set(legacyLora.lora_name || legacyLora.modelId, transformed._id);
    }
  }

  const loraTrainings = trainingRaw.map(t => transformTrainingJob(t, loraIdMap, loraModels));

  console.log(`\n✅ Transformed ${loraModels.length} LoRA models and ${loraTrainings.length} training jobs.`);
  if (loraModels[0]) {
    console.log('\n🔍 Sample Transformed LoRA Model:');
    console.log(JSON.stringify(loraModels[0], null, 2));
  }
  if (loraTrainings[0]) {
    console.log('\n🔍 Sample Transformed Training Job:');
    console.log(JSON.stringify(loraTrainings[0], null, 2));
  }

  return { loraModels, loraTrainings };
}

module.exports = { transformLegacyLoras };

// Run as script
if (require.main === module) {
  transformLegacyLoras().catch(err => {
    console.error('❌ Error during transformation:', err);
  });
}
