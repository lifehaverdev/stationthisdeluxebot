const { studio } = require('../../core/core');
const { logThis } = require('../../utils');
const { buildPromptObjFromWorkflow } = require('../../generation/prompt');
const { CollectionDB } = require('../../../db/index');
const StudioDB = require('../../../db/models/studio');

console.log('buildPromptObjFromWorkflow imported as:', typeof buildPromptObjFromWorkflow);
const test = false
const LOG_TRAIT = test;
const LOG_SELECT = test;
const LOG_CONFLICT = test;
const LOG_EXCLUSION = test;
const LOG_VALIDATE = test;
const crypto = require('crypto');

// === Configuration Hashing ===
function createConfigHash(collection) {
    // Extract required values
    const { totalSupply, config: { traitTypes, masterPrompt } } = collection;
    
    // Create a string of all trait prompts
    const traitPrompts = traitTypes
        .flatMap(traitType => 
            traitType.traits.map(trait => trait.prompt)
        )
        .sort() // Sort for consistency
        .join('|'); // Join with delimiter
    
    // Combine all values into a single string
    const configString = `${masterPrompt}|${traitPrompts}|${totalSupply}`;
    
    // Create SHA-256 hash
    const hash = crypto.createHash('sha256')
        .update(configString)
        .digest('hex');
    
    return hash;
}

// === Collection Loading ===
async function getOrLoadCollection(userId, collectionId) {
    console.log('userId',userId,'collectionId',collectionId)
    if (studio[userId]?.[collectionId]) {
        console.log(`Using cached collection data for user ${userId}, collection ${collectionId}`);
        return studio[userId][collectionId];
    }

    console.log(`Loading collection data for user ${userId}, collection ${collectionId} from database...`);
    const collectionDB = new CollectionDB();
    const collectionData = await collectionDB.loadCollection(collectionId);

    if (!collectionData) {
        throw new Error(`collection data not found for ID ${collectionId}`);
    }

    // Initialize studio for the user if necessary
    if (!studio[userId]) {
        studio[userId] = {};
    }

    // Cache the loaded data in the namespaced studio
    studio[userId][collectionId] = collectionData;
    return collectionData;
}



// === Prompt Processing ===
function findExclusions(masterPrompt) {
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Processing master prompt: ${masterPrompt}`);
    const exclusions = [];
    
    // Updated regex to be less greedy and match individual blocks
    const exclusionRegex = /\[([^\[\]]*\[[^\[\]]+\][^\[\]]*)\]\{([^}]+)\}/g;
    let match;

    while ((match = exclusionRegex.exec(masterPrompt)) !== null) {
        const content = match[1];
        const exclusionGroup = match[2].split(',').map(trait => trait.trim());
        
        logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found content: "${content}" with exclusions: ${exclusionGroup.join(', ')}`);
        
        // Find the inner trait(s) - only match single-bracketed items
        const traitMatches = content.match(/\[([^\[\]]+)\]/g) || [];
        const traits = traitMatches.map(m => m.slice(1, -1).trim());

        if (traits.length > 0) {
            traits.forEach(targetTrait => {
                logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found target trait: ${targetTrait}`);
                
                exclusionGroup.forEach(exclusion => {
                    if (!exclusion) return;
                    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Adding exclusion: ${targetTrait} <-> ${exclusion}`);
                    exclusions.push({
                        targetTrait,
                        exclusion
                    });
                });
            });
        } else {
            logThis(LOG_EXCLUSION, `[EXCLUSIONS] Warning: No traits found in content: ${content}`);
        }
    }

    // Clean the master prompt by removing only the exclusion markers
    const cleanedPrompt = masterPrompt.replace(/\{[^{}]*\}/g, '');
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Cleaned prompt: ${cleanedPrompt}`);
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found ${exclusions.length} total exclusions`);

    return {
        exclusions,
        cleanedPrompt
    };
}

function processPromptWithOptionals(masterPrompt, traitValues) {
    let processedPrompt = masterPrompt;
    console.log('traitValues',traitValues)
    // First pass: Process trait values and track which ones are empty
    const emptyTraits = new Set();
    Object.entries(traitValues).forEach(([traitType, value]) => {
        if (!value || value.trim() === '' || value === '0' || 
            value.toLowerCase() === 'null' || value.toLowerCase() === 'empty') {
            emptyTraits.add(traitType);
        }
    });
    
    // Add any unselected traits to emptyTraits
    const allTraitMatches = masterPrompt.match(/\[+([^\]\[]+)\]+/g) || [];
    allTraitMatches.forEach(match => {
        const traitName = match.replace(/[\[\]]/g, '').trim();
        if (!traitValues.hasOwnProperty(traitName)) {
            emptyTraits.add(traitName);
        }
    });

    // Second pass: Process conditional sections
    const conditionalRegex = /\[((?:[^\[\]]|\[[^\[\]]*\])*)\](?:\{([^}]*)\})?/g;
    let match;
    while ((match = conditionalRegex.exec(masterPrompt)) !== null) {
        const [fullMatch, content, exclusions] = match;
        
        // If there are exclusions, check them
        if (exclusions) {
            const excludedTraits = exclusions.split(',').map(t => t.trim());
            if (excludedTraits.some(trait => !emptyTraits.has(trait))) {
                processedPrompt = processedPrompt.replace(fullMatch, '');
                continue;
            }
        }
        
        // Process nested traits in the content
        let processedContent = content;
        const contentTraits = content.match(/\[+([^\]\[]+)\]+/g) || [];
        const hasValidTrait = contentTraits.some(trait => {
            const traitName = trait.replace(/[\[\]]/g, '').trim();
            return !emptyTraits.has(traitName) && traitValues[traitName];
        });
        
        if (!hasValidTrait) {
            processedPrompt = processedPrompt.replace(fullMatch, '');
        } else {
            contentTraits.forEach(trait => {
                const traitName = trait.replace(/[\[\]]/g, '').trim();
                if (traitValues[traitName]) {
                    processedContent = processedContent.replace(
                        new RegExp(`\\[+${traitName}\\]+`, 'g'),
                        traitValues[traitName]
                    );
                }
            });
            processedPrompt = processedPrompt.replace(fullMatch, processedContent.trim());
        }
    }
    
    // Final pass: Replace remaining trait placeholders
    Object.entries(traitValues).forEach(([trait, value]) => {
        if (!emptyTraits.has(trait)) {
            processedPrompt = processedPrompt.replace(
                new RegExp(`\\[+${trait}\\]+ *(hair|eyes)?`, 'g'),
                value
            );
        }
    });
    
    // Clean up the prompt
    processedPrompt = processedPrompt
        .replace(/\[+[^\]\[]*\]+/g, '') // Remove any remaining bracketed terms
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\s*,\s*,+/g, ',') // Clean up multiple commas
        .replace(/,\s*([,\s]*,\s*)*/g, ', ') // Clean up comma spacing
        .replace(/\s*,\s*$/g, '') // Remove trailing comma
        .replace(/\s+\./g, '.') // Clean up space before period
        .trim();
    
    return processedPrompt;
}

// === Trait Selection ===
class TraitSelector {
    static selectTraitValue(traitType) {
        logThis(LOG_SELECT, `[TRAIT_SELECT] Starting trait selection for type: ${traitType.title}`);
        
        if (!traitType.traits || !traitType.traits.length) {
            logThis(LOG_SELECT, `[TRAIT_SELECT] No traits found for ${traitType.title}`);
            return null;
        }
        
        let totalWeight = 0;
        traitType.traits.forEach(trait => {
            const weight = trait.rarity || 0.5;
            totalWeight += weight;
            logThis(LOG_SELECT, `[TRAIT_SELECT] Adding weight for ${trait.name}: ${weight}`);
        });
        
        logThis(LOG_SELECT, `[TRAIT_SELECT] Total weight calculated: ${totalWeight}`);
        let random = Math.random() * totalWeight;
        logThis(LOG_SELECT, `[TRAIT_SELECT] Random value generated: ${random}`);
        
        for (const trait of traitType.traits) {
            random -= (trait.rarity || 0.5);
            logThis(LOG_SELECT, `[TRAIT_SELECT] Remaining random after ${trait.name}: ${random}`);
            if (random <= 0) {
                logThis(LOG_SELECT, `[TRAIT_SELECT] Selected trait: ${trait.name} with prompt: ${trait.prompt}`);
                return trait;
            }
        }
        
        return traitType.traits[0];
    }

    static isEmptyValue(value) {
        logThis(LOG_SELECT, `[EMPTY_CHECK] Checking value: "${value}"`);
        const isEmpty = !value || 
                       value.trim() === '' || 
                       value === '0' || 
                       value.toLowerCase() === 'null' || 
                       value.toLowerCase() === 'empty';
        logThis(LOG_SELECT, `[EMPTY_CHECK] Is empty? ${isEmpty}`);
        return isEmpty;
    }

    static buildConflictMap(exclusions) {
        logThis(LOG_CONFLICT, `[CONFLICT_MAP] Building conflict map from ${exclusions.length} exclusions`);
        const conflictMap = new Map();
        
        exclusions.forEach(({ targetTrait, exclusion }) => {
            logThis(LOG_CONFLICT, `[CONFLICT_MAP] Processing conflict: ${targetTrait} <-> ${exclusion}`);
            
            if (!conflictMap.has(targetTrait)) {
                logThis(LOG_CONFLICT, `[CONFLICT_MAP] Creating new Set for ${targetTrait}`);
                conflictMap.set(targetTrait, new Set());
            }
            if (!conflictMap.has(exclusion)) {
                logThis(LOG_CONFLICT, `[CONFLICT_MAP] Creating new Set for ${exclusion}`);
                conflictMap.set(exclusion, new Set());
            }
            
            logThis(LOG_CONFLICT, `[CONFLICT_MAP] Added bidirectional conflict: ${targetTrait} <-> ${exclusion}`);
            conflictMap.get(targetTrait).add(exclusion);
            conflictMap.get(exclusion).add(targetTrait);
        });
        
        logThis(LOG_CONFLICT, `[CONFLICT_MAP] Final map size: ${conflictMap.size} traits`);
        conflictMap.forEach((conflicts, trait) => {
            logThis(LOG_CONFLICT, `[CONFLICT_MAP] ${trait} conflicts with: ${[...conflicts].join(', ')}`);
        });
        
        return conflictMap;
    }
    static resolveConflicts(selectedTraits, conflictMap) {
        logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Starting conflict resolution`);
        logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Starting conflict resolution`);
        logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Initial traits:`, selectedTraits);
        
        const conflictingTraits = new Set(
            [...conflictMap.keys()].filter(trait => selectedTraits[trait])
        );
        logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Found ${conflictingTraits.size} traits with potential conflicts`);
        
        for (const traitType of conflictingTraits) {
            logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Processing conflicts for: ${traitType}`);
            const conflicts = conflictMap.get(traitType);
            const activeConflicts = [...conflicts].filter(conflict => selectedTraits[conflict]);
            
            logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Active conflicts found: ${activeConflicts.join(', ')}`);
            
            if (activeConflicts.length > 0) {
                const allConflictingTraits = [traitType, ...activeConflicts];
                logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] All conflicting traits: ${allConflictingTraits.join(', ')}`);
                
                const nonEmptyTraits = allConflictingTraits.filter(t => 
                    !this.isEmptyValue(selectedTraits[t])
                );
                logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Non-empty conflicting traits: ${nonEmptyTraits.join(', ')}`);
                
                if (nonEmptyTraits.length > 1) {
                    const winner = nonEmptyTraits[Math.floor(Math.random() * nonEmptyTraits.length)];
                    logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Randomly selected winner: ${winner}`);
                    
                    allConflictingTraits.forEach(t => {
                        if (t !== winner) {
                            logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Removing conflicting trait: ${t}`);
                            delete selectedTraits[t];
                        }
                    });
                }
            }
        }
        
        logThis(LOG_TRAIT, `[CONFLICT_RESOLVE] Final resolved traits:`, selectedTraits);
        return selectedTraits;
    }
    static generateTraitSelection(traitTypes, conflictMap) {
        logThis(LOG_TRAIT, `[TRAIT_GENERATE] Starting trait generation with ${traitTypes.length} types`);
        
        const selectedTraits = {};
        const traitDetails = []; // Store full trait details
        const shuffledTypes = [...traitTypes].sort(() => Math.random() - 0.5);
        
        // First pass: Select traits
        shuffledTypes.forEach(traitType => {
            logThis(LOG_TRAIT, `[TRAIT_GENERATE] Processing selection for: ${traitType.title}`);
            const selected = this.selectTraitValue(traitType);
            if (selected) {
                logThis(LOG_TRAIT, `[TRAIT_GENERATE] Selected ${traitType.title}: ${selected.name}`);
                selectedTraits[traitType.title] = selected.prompt;
                
                // Store full trait details
                traitDetails.push({
                    type: traitType.title,
                    value: {
                        name: selected.name,
                        prompt: selected.prompt,
                        rarity: selected.rarity
                    }
                })
            }
        });
        
        logThis(LOG_TRAIT, `[TRAIT_GENERATE] Initial selection complete. Resolving conflicts...`);
        console.log('traitDetails',traitDetails)
        const resolvedTraits = this.resolveConflicts(selectedTraits, conflictMap);

        // Return both prompt traits and detailed traits
        return {
            selectedTraits: resolvedTraits,
            traitDetails: traitDetails
        };
    }
}

// === Validation ===
function validateMasterPrompt(masterPrompt) {
    logThis(LOG_VALIDATE, `[VALIDATE] Starting validation of master prompt: ${masterPrompt}`);
    
    const errors = [];
    const stack = [];
    let currentPos = 0;
    
    // Track different types of brackets
    const BRACKET_PAIRS = {
        '[': ']',
        '{': '}'
    };
    
    // Helper to add formatted error messages
    const addError = (message, position) => {
        const preview = masterPrompt.substring(Math.max(0, position - 20), position + 20);
        errors.push(`${message} at position ${position}:\n...${preview}...`);
    };

    for (let i = 0; i < masterPrompt.length; i++) {
        const char = masterPrompt[i];
        
        // Handle opening brackets
        if (char === '[' || char === '{') {
            logThis(LOG_VALIDATE, `[VALIDATE] Found opening ${char} at position ${i}`);
            stack.push({ char, position: i });
            continue;
        }
        
        // Handle closing brackets
        if (char === ']' || char === '}') {
            logThis(LOG_VALIDATE, `[VALIDATE] Found closing ${char} at position ${i}`);
            
            if (stack.length === 0) {
                addError(`Unexpected closing ${char}`, i);
                continue;
            }
            
            const lastOpening = stack.pop();
            const expectedClosing = BRACKET_PAIRS[lastOpening.char];
            
            if (char !== expectedClosing) {
                addError(`Mismatched brackets: expected ${expectedClosing} but found ${char}`, i);
            }
        }
    }
    
    // Check for unclosed brackets
    while (stack.length > 0) {
        const unclosed = stack.pop();
        addError(`Unclosed ${unclosed.char}`, unclosed.position);
    }
    
    // Validate trait placeholders [[trait]]
    const traitPlaceholders = masterPrompt.match(/\[\[([^\]]*)\]\]/g) || [];
    logThis(LOG_VALIDATE, `[VALIDATE] Found ${traitPlaceholders.length} trait placeholders`);
    
    traitPlaceholders.forEach(placeholder => {
        const trait = placeholder.slice(2, -2).trim();
        if (!trait) {
            addError(`Empty trait placeholder`, masterPrompt.indexOf(placeholder));
        }
    });
    
    // Validate exclusion syntax [content]{exclusion}
    const exclusionRegex = /\[([^\]]*\[[^\]]*\][^\]]*)\]\{([^}]+)\}/g;
    const exclusionGroups = [...masterPrompt.matchAll(exclusionRegex)];
    logThis(LOG_VALIDATE, `[VALIDATE] Searching for exclusion groups with regex: ${exclusionRegex}`);
    logThis(LOG_VALIDATE, `[VALIDATE] Found ${exclusionGroups.length} exclusion groups:`);
    
    exclusionGroups.forEach(match => {
        const [fullMatch, content, exclusion] = match;
        logThis(LOG_VALIDATE, `[VALIDATE] Exclusion group found:`, {
            fullMatch,
            content,
            exclusion,
            position: match.index
        });
        
        if (!exclusion.trim()) {
            addError(`Empty exclusion`, match.index);
        }
    });


    // Check for nested trait placeholders in exclusion groups
    const nestedTraits = masterPrompt.match(/\[\[([^\]]*)\]\]\{/g);
    if (nestedTraits) {
        nestedTraits.forEach(match => {
            addError(`Trait placeholder directly followed by exclusion`, masterPrompt.indexOf(match));
        });
    }

    const isValid = errors.length === 0;
    logThis(LOG_VALIDATE, `[VALIDATE] Validation complete. Valid: ${isValid}`);
    if (!isValid) {
        logThis(LOG_VALIDATE, `[VALIDATE] Found ${errors.length} errors:`);
        errors.forEach(error => logThis(LOG_VALIDATE, `[VALIDATE] Error: ${error}`));
    }

    return {
        isValid,
        errors,
        formattedErrors: errors.join('\n')
    };
}
// === Workflow Processing ===
function buildCookModePromptObjFromWorkflow(workflow, userContext, message) {
    let promptObj = buildPromptObjFromWorkflow(workflow, userContext, message)
    promptObj = {
        ...promptObj,
        isCookMode: true,
        collectionId: userContext.collectionId,
        traits: userContext.traits,
        configHash: userContext.configHash
    };

    return promptObj;
}

// === Progress Calculation ===
function calculateCompletionPercentage(collectionData) {
    const { config } = collectionData;
    const traitTypes = config.traitTypes;

    if (traitTypes.length === 0) {
        return 0;
    }

    const maxTraitTypes = 10;
    const currentTraitTypes = traitTypes.length;
    const completionPercentage = Math.min((currentTraitTypes / maxTraitTypes) * 100, 100);

    return completionPercentage;
}


async function getCollectionGenerationCount(collectionId) {
    try {
        const studio = new StudioDB();
        
        // Get all pieces for this collection
        const pieces = await studio.findMany({ collectionId });
        
        // Count pieces that are either pending_review or approved
        const validCount = pieces.filter(piece => 
            piece.status === 'pending_review' || piece.status === 'approved'
        ).length;
        
        return validCount;
    } catch (error) {
        console.error('Error getting generation count:', error);
        return 0; // Return 0 as fallback
    }
}

module.exports = {
    getOrLoadCollection,
    calculateCompletionPercentage,
    findExclusions,
    processPromptWithOptionals,
    TraitSelector,
    validateMasterPrompt,
    buildCookModePromptObjFromWorkflow,
    getCollectionGenerationCount,
    createConfigHash
};