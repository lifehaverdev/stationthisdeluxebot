const { 
    lobby, 
    studio, 
    STATES, getBotInstance,
    stateHandlers,
    actionMap,
    prefixHandlers,
 } = require('../bot')
const { 
    sendMessage, 
    editMessage, 
    setUserState, 
    safeExecute,
    updateMessage,
    react ,
    logThis
} = require('../../utils')
// const { 
//     createCollection,
//     loadCollection,
//     getCollectionsByUserId,
//     writeUserDataPoint,
//     deleteStudio,
//     saveStudio,
//  } = require('../../../db/mongodb')
 const { getOrLoadCollection, calculateCompletionPercentage } = require('./collectionmode/collectionUtils');
 const { CollectionMenuBuilder } = require('./collectionmode/menuBuilder');
 const { StudioManager } = require('./collectionmode/studioManager')
 const { StudioAction } = require('./collectionmode/studioAction');
 const { gptAssist, formatters } = require('../../../commands/assist');
 const fs = require('fs')
 const { checkIn } = require('../gatekeep')
 const { CollectionDB, UserCore } = require('../../../db/index');
 const collectionDB = new CollectionDB();
 const userCore = new UserCore();

 const studioAction = new StudioAction(studio)

// Logging toggles
const test = false;
const LOG_TEST = test;
const LOG_TRAIT = test;
const LOG_SELECT = test;
const LOG_CONFLICT = test;
const LOG_EXCLUSION = test;
const LOG_VALIDATE = test;

/*

*/
async function getMyCollections(userId) {
    let collectionKeyboardOptions = [];
    
    try {
        const collections = await collectionDB.getCollectionsByUserId(userId);
        
        if (collections.length > 0) {
            for (const collection of collections) {
                collectionKeyboardOptions.push([{ 
                    text: `${collection.name}`, 
                    callback_data: `ec_${collection.collectionId}` 
                }]);
            }
        }

        if (collections.length < 3) {
            collectionKeyboardOptions.push([{ text: '➕', callback_data: 'newcollection' }]);
        }

    } catch (error) {
        console.error('Failed to load collections:', error);
    }

    return collectionKeyboardOptions;
}

prefixHandlers['ec_'] = (action, message, user) => handlePrefix(action, message, user, 'editCollection')
actionMap['editCollection'] = handleCollectionMenu

async function handleCollectionModeMenu(message, user) {
    console.log('Entering collection mode menu for user:', user);
    const chatId = message.chat.id;
    const messageId = message.message_id;
    try {
        const mycollections = await getMyCollections(user) || [];
        const replyMarkup = {
            inline_keyboard: [
                [{ text: '↖︎', callback_data: 'accountSettingsMenu' }],
                ...mycollections,
                [{ text: 'nvm', callback_data: 'cancel' }]
            ]
        };
        const txt = '🌟Stationthisbot Collection Creation 👩‍🎨🖼️';
    await editMessage({
        reply_markup: replyMarkup,
        chat_id: chatId,
        message_id: messageId,
        text: txt,
    });
    } catch (error) {
        console.log('failed to handle collection mode menu', error);
        sendMessage(DEV_DMS, `collection mode menu handle fail ${error}`)
    }
    
}

actionMap['collectionModeMenu'] = handleCollectionModeMenu
actionMap['newcollection'] = newCollection

async function newCollection(message) {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    //if(message.reply_to_message)
    setUserState(message.reply_to_message, STATES.COLLECTIONNAME)
    editMessage({
        text: 'What is the name of the collection?',
        message_id: messageId,
        chat_id: chatId
    })
}

stateHandlers[STATES.COLLECTIONNAME] = (message) => safeExecute(message,createConfig)

async function createConfig(message) {
    const name = message.text;
    const userId = message.from.id
    const hashId = Math.floor(10000000000000 * Math.random())
    console.log('this is the hash',hashId)
    if(!lobby.hasOwnProperty(userId)){
        console.log('SUS someone is trying to make a collectiom but we are in create collection rn and they arent in the lobby')
        return
    }
    const userContext = lobby[userId]
    const thisCollection = {
        collectionId: hashId,
        name,
        userId,
        iter: '1.0',
        version: '',
        size: 10,
        config: {
            masterPrompt: '',
            traitTypes: [],
            workflow: 'FLUX'
        },
        initiated: Date.now(),
        status: 'incomplete'
    }
    // Ensure studio[userId] is an object
    if (!studio.hasOwnProperty(userId)) {
        studio[userId] = {};
    }
    studio[userId][thisCollection.collectionId] = thisCollection;
    try {
        const success = await collectionDB.createCollection(thisCollection)
        if(!success){
            await sendMessage(message, 'Collection creation failed');
            return
        }
    } catch (err) {
        console.error('Error during Collection creation:', err);
        await sendMessage(message, 'Collection creation encountered an error.');
        return;
    }
    
    const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionMenu(userId,hashId)
    sendMessage(message, text, { reply_markup })
    setUserState(message,STATES.IDLE)
}

async function handleCollectionMenu(message,user,collectionId) {
    console.log('Entering collection menu for user:', user, 'collection:', collectionId);
    const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id,{reply_markup},text)
    setUserState(message,STATES.IDLE)
}

//prefixHandlers['rmc_'] = 
// prefixHandlers['rmc_'] = (action, message, user) => handlePrefix(action, message, user, 'removeCollection');
actionMap[`removeCollection`] = removeCollection
prefixHandlers['rmc_']= (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap['removeCollection'](message,user,collectionId)
}

prefixHandlers['savec_']= (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap['saveCollection'](message,user,collectionId)
}
actionMap['saveCollection'] = handleSaveCollection
async function handleSaveCollection(message,user,collectionId) {
    console.log('handle save collection',message,user,collectionId)
    await collectionDB.saveStudio(studio[user][collectionId]);
    await handleCollectionMenu(message,user,collectionId)
}

async function removeCollection(message,user, collectionId) {
    StudioManager.removeCollection(user, collectionId)
    // Delete the collection data from the database and associated files
    await collectionDB.deleteCollection(collectionId);
    await handleCollectionModeMenu(message,user)
}

function handlePrefix(action, message, user, actionKey) {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap[actionKey](message, user, collectionId);
}

prefixHandlers[`collectionMetaData_`] = (action, message, user) => handlePrefix(action, message, user, 'collectionMetaData')
actionMap['collectionMetaData'] = handleCollectionMetaData

async function handleCollectionMetaData(message,user,collectionId) {
    console.log('Entering collection metadata menu for user:', user, 'collection:', collectionId);
    const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionMetaDataMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id, { reply_markup }, text)
}

prefixHandlers['supply_'] = (action, message, user) => handlePrefix(action, message, user, 'setSupply')
actionMap['setSupply'] = handleSetSupply
prefixHandlers['chain_'] = (action, message, user) => handlePrefix(action, message, user, 'setChain')
actionMap['setChain'] = handleSetChainMessage
prefixHandlers['royalty_'] = (action, message, user) => handlePrefix(action, message, user, 'setRoyalty')
actionMap['setRoyalty'] = handleSetRoyalty
prefixHandlers['editionTitle_'] = (action, message, user) => handlePrefix(action, message, user, 'setEditionTitle')
actionMap['setEditionTitle'] = handleSetEditionTitle
prefixHandlers['description_'] = (action, message, user) => handlePrefix(action, message, user, 'setDescription')
actionMap['setDescription'] = handleSetDescription
// Modify handleSetSupply to use the new system
async function handleSetSupply(message, user, collectionId) {
    console.log('handle set supply', message, user, collectionId);
    
    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'supply',
        'Please enter the total supply for your collection:'
    );

    await editMessage(messageConfig);
}

async function handleSetRoyalty(message, user, collectionId) {
    console.log('handle set royalty', message, user, collectionId);
    
    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'royalty',
        'Please enter the royalty percentage 0-100 for your collection:'
    );

    await editMessage(messageConfig);
}
async function handleSetEditionTitle(message, user, collectionId) {
    console.log('handle set edition title', message, user, collectionId);
    
    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'editionTitle',
        'Please enter the edition title for your collection pieces:\n\n(e.g. "Milady "2344 or "#"2344 or "Milady #"2344)'
    );

    await editMessage(messageConfig);
}

async function handleSetDescription(message, user, collectionId) {
    console.log('handle set description', message, user, collectionId);
    
    const existingDescription = studio[user][collectionId]?.description || '';
    
    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'description',
        `Please enter the description for your collection metadata:${existingDescription ? `\n\nCurrent description:\n\`${existingDescription}\`` : ''}`,
        { options: { parse_mode: 'MarkdownV2' } }
    );

    await editMessage(messageConfig);
}

async function handleSetChainMessage(message,user,collectionId) {
    //console.log('handle set chain',message,user,collectionId)
    if (!studio[user]) {
        studio[user] = {};
    }
    const reply_markup = {
        inline_keyboard: [
            [{ text: '↖︎', callback_data: `ec_${collectionId}` }],
            [{ text: 'Ethereum', callback_data: `ecchain_eth_${collectionId}` }],
            [{ text: 'Solana', callback_data: `ecchain_sol_${collectionId}` }],
        ]
    }

    // Update message and set state
    console.log('editing message in handle set chain')
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please choose the chain for your collection:',
        reply_markup,
    });
}

prefixHandlers['ecchain_'] = (action, message, user) => {
    const chain = action.split('_')[1]
    const collectionId = parseInt(action.split('_')[2])
    handleSetChain(message,user,collectionId,chain)
}

async function handleSetChain(message,user,collectionId,chain) {
    console.log('handle set chain',message,user,collectionId,chain)
    studio[user][collectionId].chain = chain
    await collectionDB.saveStudio(studio[user][collectionId]);
    //delete studio[user].pendingAction;
    setUserState(message, STATES.IDLE);
    await handleCollectionMenu(message,user,collectionId)
}

// Standard Selection Handler
prefixHandlers['setMetadataStandard_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleSetMetadataStandard(message, user, collectionId);
}

async function handleSetMetadataStandard(message, user, collectionId) {
    const reply_markup = {
        inline_keyboard: [
            [
                { text: 'Metaplex (Solana)', callback_data: `confirmStandard_${collectionId}_metaplex` },
                { text: 'ERC721', callback_data: `confirmStandard_${collectionId}_erc721` }
            ],
            [
                { text: 'ERC1155', callback_data: `confirmStandard_${collectionId}_erc1155` }
            ],
            [{ text: '« Back', callback_data: `collectionMetadataMenu_${collectionId}` }]
        ]
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Select the metadata standard for your collection:',
        reply_markup
    });
}

// Standard Confirmation Handler
prefixHandlers['confirmStandard_'] = (action, message, user) => {
    const [_, collectionId, standard] = action.split('_');
    handleConfirmStandard(message, user, parseInt(collectionId), standard);
}

async function handleConfirmStandard(message, user, collectionId, standard) {
    const collection = await getOrLoadCollection(user, collectionId);
    
    // Initialize or update metadata config
    if (!collection.config.metadataConfig) {
        collection.config.metadataConfig = {};
    }
    
    collection.config.metadataConfig.standard = standard;
    
    // Initialize standard-specific defaults
    if (standard === 'metaplex') {
        collection.config.metadataConfig.propertyDefaults = {
            category: 'image',
            fileType: 'image/png'
        };
    }
    
    await collectionDB.saveStudio(collection);
    handleCollectionMetaData()
}

                        // Add the state handler
                        stateHandlers[STATES.SETCOLLECTION] = async (message) => {
                            const userId = message.from.id;
                            if (!studio[userId]?.pendingAction) {
                                console.log('No pending action found for user:', userId);
                                return;
                            }

                            const { action, collectionId, traitTypeIndex = null, valueIndex = null } = studio[userId].pendingAction;
                            console.log('Handling state SETCOLLECTION for user:', userId, 'action:', action, 'collection:', collectionId);

                            const userInput = message.text;
                            let backTo = 'main'
                            switch (action) {
                                case 'supply':
                                    const supply = parseInt(userInput);
                                    if (isNaN(supply) || supply <= 0) {
                                        await sendMessage(message, 'Please enter a valid number greater than 0');
                                        return;
                                    }
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        totalSupply: supply
                                    });
                                    backTo = 'metadata'
                                    break;
                                case 'royalty':
                                    const royalty = parseInt(userInput);
                                    if (isNaN(royalty) || royalty < 0 || royalty > 100) {
                                        await sendMessage(message, 'Please enter a valid number between 0 and 100');
                                        return;
                                    }
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        royalties: royalty
                                    });
                                    backTo = 'metadata'
                                    break;
                                case 'editionTitle':
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        editionTitle: message.text
                                    });
                                    backTo = 'metadata'
                                    break;
                                case 'description':
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        description: message.text
                                    });
                                    backTo = 'metadata'
                                    break;
                                case 'editMasterPrompt':
                                    console.log('edit master prompt', message, userId, collectionId)
                                    console.log(StudioManager)
                                    backTo = await StudioManager.updateMasterPrompt(userId, collectionId, message);
                                    break;
                                case 'addTrait':
                                    backTo = await StudioManager.addTraitType(message, userId, collectionId)
                                    break;
                                case 'editTraitName':
                                    backTo = await StudioManager.editTraitTypeName(message, userId, collectionId, traitTypeIndex)
                                    break;
                                case 'editWorkflow':
                                    const workflow = message.text;
                                    const validWorkflows = ['FLUX','MAKE', 'MAKE3']
                                    if(!validWorkflows.includes(workflow)){
                                        await sendMessage(message, 'Please enter a valid workflow type: FLUX MAKE or MAKE3');
                                        return;
                                    }
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        config: {
                                            ...studio[userId][collectionId].config,
                                            workflow: workflow
                                        }
                                    });
                                    backTo = 'config'
                                    break;
                                case 'addTraitValue':
                                    backTo = await StudioManager.addTraitValue(message, userId, collectionId, traitTypeIndex)
                                    break;
                                case 'editTraitValueName':
                                    const { traitTypeIndex: nameTypeIndex, valueIndex: nameValueIndex } = studio[userId].pendingAction;
                                    const updatedTraitTypes = [...studio[userId][collectionId].config.traitTypes];
                                    updatedTraitTypes[nameTypeIndex].traits[nameValueIndex].name = message.text;
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        config: {
                                            ...studio[userId][collectionId].config,
                                            traitTypes: updatedTraitTypes
                                        }
                                    });
                                    backTo = 'traitTypes';
                                    break;

                                case 'editTraitValuePrompt':
                                    const { traitTypeIndex: promptTypeIndex, valueIndex: promptValueIndex } = studio[userId].pendingAction;
                                    const updatedPromptTraits = [...studio[userId][collectionId].config.traitTypes];
                                    updatedPromptTraits[promptTypeIndex].traits[promptValueIndex].prompt = message.text;
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        config: {
                                            ...studio[userId][collectionId].config,
                                            traitTypes: updatedPromptTraits
                                        }
                                    });
                                    backTo = 'traitTypes';
                                    break;

                                case 'editTraitValueRarity':
                                    const { traitTypeIndex: rarityTypeIndex, valueIndex: rarityValueIndex } = studio[userId].pendingAction;
                                    const newRarity = parseFloat(message.text);
                                    if (isNaN(newRarity) || newRarity < 0) {
                                        await sendMessage(message, 'Please enter a valid positive number for rarity');
                                        return;
                                    }
                                    const updatedRarityTraits = [...studio[userId][collectionId].config.traitTypes];
                                    updatedRarityTraits[rarityTypeIndex].traits[rarityValueIndex].rarity = newRarity;
                                    await StudioManager.updateCollection(userId, collectionId, {
                                        config: {
                                            ...studio[userId][collectionId].config,
                                            traitTypes: updatedRarityTraits
                                        }
                                    });
                                    backTo = 'traitTypes';
                                    break;
                                case 'consultAI':
                                    handleConsultAI(message, userId, collectionId);
                                    break;
                                default:
                                    console.log('no action found for set collection')
                                    return
                                // Add other cases here for different settings
                            }

    // Save changes and reset state
    //await collectionDB.saveStudio(studio[userId][collectionId]);
    console.log('backTo', backTo)
    studioAction.clearPendingAction(userId);
    setUserState(message, STATES.IDLE);
    
    // Return to metadata menu
    if(backTo === 'metadata'){
        const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionMetaDataMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    } else if (backTo === 'config') {
        const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionConfigMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    } else if (backTo === 'traitTypes') {
        const { text, reply_markup } = await CollectionMenuBuilder.buildTraitTypesMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    }
}

prefixHandlers['collectionConfigMenu_'] = (action, message, user) => handlePrefix(action, message, user, 'collectionConfigMenu')
actionMap['collectionConfigMenu'] = handleCollectionConfigMenu
async function handleCollectionConfigMenu(message,user,collectionId) {
    console.log('Entering collection config menu for user:', user, 'collection:', collectionId);
    console.log('handle collection config menu',message,user,collectionId)
    const { text, reply_markup } = await CollectionMenuBuilder.buildCollectionConfigMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id, { reply_markup }, text)
    setUserState(message,STATES.IDLE)
}


prefixHandlers['editWorkflow_'] = (action, message, user) => handlePrefix(action, message, user, 'editWorkflow')
actionMap['editWorkflow'] = handleEditWorkflow
async function handleEditWorkflow(message,user,collectionId) {
    console.log('Handling edit workflow for user:', user, 'collection:', collectionId);
    // Set pending action for workflow edit
    studio[user].pendingAction = {
        action: 'editWorkflow',
        collectionId: collectionId
    };

    const text = 'Please enter the workflow type:\n\nFLUX MAKE - For standard image generation\nMAKE3 - For 3D model generation';

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['testCollection_'] = (action, message, user) => handlePrefix(action, message, user, 'testCollection')
actionMap['testCollection'] = handleTestCollection

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
                const allConflictingTraits = [traitType, ...activeConflictingTraits];
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
        const shuffledTypes = [...traitTypes].sort(() => Math.random() - 0.5);
        logThis(LOG_TRAIT, `[TRAIT_GENERATE] Shuffled trait types:`, shuffledTypes.map(t => t.title));
        
        // First pass: Select traits
        shuffledTypes.forEach(traitType => {
            logThis(LOG_TRAIT, `[TRAIT_GENERATE] Processing selection for: ${traitType.title}`);
            const selected = this.selectTraitValue(traitType);
            if (selected) {
                logThis(LOG_TRAIT, `[TRAIT_GENERATE] Selected ${traitType.title}: ${selected.prompt}`);
                selectedTraits[traitType.title] = selected.prompt;
            } else {
                logThis(LOG_TRAIT, `[TRAIT_GENERATE] No value selected for ${traitType.title}`);
            }
        });
        
        logThis(LOG_TRAIT, `[TRAIT_GENERATE] Initial selection complete. Resolving conflicts...`);
        const resolvedTraits = this.resolveConflicts(selectedTraits, conflictMap);
        logThis(LOG_TRAIT, `[TRAIT_GENERATE] Final trait selection:`, resolvedTraits);
        
        return resolvedTraits;
    }
}
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

// Update handleTestCollection to use validation
async function handleTestCollection(message, user, collectionId) {
    logThis(LOG_TEST, `[TEST_COLLECTION] Starting test collection for user: ${user}, collection: ${collectionId}`);
    
    const collection = await getOrLoadCollection(user, collectionId);
    logThis(LOG_TEST, `[TEST_COLLECTION] Loaded collection: ${collection.name}`);
    
    const { masterPrompt, traitTypes } = collection.config;
    const { isValid, errors, formattedErrors } = validateMasterPrompt(masterPrompt);
    if (!isValid) {
        logThis(LOG_TEST, `[TEST_COLLECTION] Master prompt validation failed with errors:`);
        logThis(LOG_TEST, formattedErrors);
        await react(message, '🥴')
        return;
    }
    const prefix = collection.config.workflow?.toLowerCase() || 'flux';
    logThis(LOG_TEST, `[TEST_COLLECTION] Using workflow prefix: ${prefix}`);
    
    logThis(LOG_TEST, `[TEST_COLLECTION] Processing master prompt for exclusions: ${masterPrompt}`);
    const { exclusions, cleanedPrompt } = findExclusions(masterPrompt);
    logThis(LOG_TEST, `[TEST_COLLECTION] Found ${exclusions.length} exclusions`);
    logThis(LOG_TEST, `[TEST_COLLECTION] Cleaned prompt: ${cleanedPrompt}`);
    
    const conflictMap = TraitSelector.buildConflictMap(exclusions);
    logThis(LOG_TEST, `[TEST_COLLECTION] Built conflict map with ${conflictMap.size} entries`);
    
    const selectedTraits = TraitSelector.generateTraitSelection(traitTypes, conflictMap);
    logThis(LOG_TEST, `[TEST_COLLECTION] Generated trait selection: ${selectedTraits}`);
    
    const testPrompt = processPromptWithOptionals(cleanedPrompt, selectedTraits);
    logThis(LOG_TEST, `[TEST_COLLECTION] Final processed prompt: ${testPrompt}`);

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: `Test Prompt Generated:\n\n\`\/${prefix} ${testPrompt}\`\n\nSelected Traits:\n${Object.entries(selectedTraits).map(([title, prompt]) => `${title}: ${prompt}`).join('\n')}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: '« Back', callback_data: `collectionConfigMenu_${collectionId}` }],
                [{ text: 'Generate Another', callback_data: `testCollection_${collectionId}` }]
            ]
        },
        options: {
            parse_mode: 'MarkdownV2'
        }
    });
    logThis(LOG_TEST, `[TEST_COLLECTION] Test collection complete`);
}

prefixHandlers['editMasterPrompt_'] = (action, message, user) => handlePrefix(action, message, user, 'editMasterPrompt')
actionMap['editMasterPrompt'] = handleEditMasterPrompt
async function handleEditMasterPrompt(message, user, collectionId) {
    console.log('Handling edit master prompt for user:', user, 'collection:', collectionId);
    const collection = await getOrLoadCollection(user, collectionId);
    
    // Escape special markdown characters in the example text
    let text = 'Please enter the new master prompt for your collection:\n\n' +
               'Current master prompt:\n' +
               `\`${collection.config.masterPrompt || 'No master prompt set'}\`\n\n` +
               'Use double brackets for trait insertions: [[traittype]]\n' +
               'Use nested brackets for optional text that depends on traits:\n' +
               'Example: "a character [wearing a [[hat]]]"\n' +
               '\\- With hat\\="red cap" → "a character wearing a red cap"\n' + 
               '\\- With hat\\=null → "a character"\n\n' + 
               'Current trait types: ' + 
               collection.config.traitTypes.map(trait => trait.title).join(', ');

    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'editMasterPrompt',
        text,
        { options: { parse_mode: 'MarkdownV2' } }
    );

    await editMessage(messageConfig);
}

prefixHandlers['editTraitTypes_'] = (action, message, user) => handlePrefix(action, message, user, 'editTraitTypes')
actionMap['editTraitTypes'] = handleEditTraitTypes

async function handleEditTraitTypes(message,user,collectionId) {
    console.log('handle edit trait types',message,user,collectionId)
    const { text, reply_markup } = await CollectionMenuBuilder.buildTraitTypesMenu(user, collectionId);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
    setUserState(message,STATES.IDLE)
}

// Handle page navigation
prefixHandlers['traitPage_'] = (action, message, user) => {
    const [_, collectionId, page] = action.split('_');
    handleTraitPage(message, user, parseInt(collectionId), parseInt(page));
}

async function handleTraitPage(message, user, collectionId, page) {
    console.log('Handling trait page navigation for user:', user, 'collection:', collectionId, 'page:', page);
    const { text, reply_markup } = await CollectionMenuBuilder.buildTraitTypesMenu(user, collectionId, page);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

// Add handlers for trait editing and adding new traits
prefixHandlers['addTrait_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleAddTrait(message, user, collectionId);
}

async function handleAddTrait(message, user, collectionId) {
    console.log('Handling add trait type for user:', user, 'collection:', collectionId);
    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'addTrait',
        'Please enter the name of the new trait type:'
    );
    await editMessage(messageConfig);
}

prefixHandlers['editTraitType_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex] = action.split('_');
    handleTraitTypeMenu(message, user, parseInt(collectionId), parseInt(traitTypeIndex));
}

async function handleTraitTypeMenu(message, user, collectionId, traitTypeIndex) {
    console.log('Entering trait type menu for user:', user, 'collection:', collectionId, 'traitType:', traitTypeIndex);
    const collection = await getOrLoadCollection(user, collectionId);
    const traitType = collection.config.traitTypes[traitTypeIndex];
    
    const text = `Edit trait type: ${traitType.title}\nInstances: ${traitType.traits?.length || 0}`;
    
    // Create buttons for each trait instance
    const traitInstanceButtons = traitType.traits?.map((t, i) => {
        return [{ text: t.name, callback_data: `editTraitInstance_${collectionId}_${traitTypeIndex}_${i}` }];
    }) || [];
    
    const reply_markup = {
        inline_keyboard: [
            [
                { text: '✏️ Edit Name', callback_data: `editTraitName_${collectionId}_${traitTypeIndex}` },
                { text: '➕ Add Value', callback_data: `addTraitValue_${collectionId}_${traitTypeIndex}` }
            ],
            ...traitInstanceButtons,
            [{ text: '🗑️ Delete Trait', callback_data: `deleteTrait_${collectionId}_${traitTypeIndex}` }],
            [{ text: '« Back', callback_data: `editTraitTypes_${collectionId}` }]
        ]
    };

    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

prefixHandlers['editTraitInstance_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, traitInstanceIndex] = action.split('_');
    handleTraitInstanceMenu(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(traitInstanceIndex));
}

async function handleTraitInstanceMenu(message, user, collectionId, traitTypeIndex, instanceIndex) {
    console.log('Entering trait instance menu for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'instance:', instanceIndex);
    const collection = await getOrLoadCollection(user, collectionId);
    const traitType = collection.config.traitTypes[traitTypeIndex];
    const traitInstance = traitType.traits[instanceIndex];
    
    // Check if trait instance exists
    if (!traitType?.traits || !traitType.traits[instanceIndex]) {
        console.log('Trait instance not found',traitType,instanceIndex);
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: 'Error: Trait value not found',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '« Back', callback_data: `editTraitType_${collectionId}_${traitTypeIndex}` }]
                ]
            }
        });
        return;
    }
    
    const text = `Edit trait instance: ${traitInstance.name}\n` +
                `Prompt: ${traitInstance.prompt}\n` + 
                `Rarity: ${traitInstance.rarity}`;

    const reply_markup = {
        inline_keyboard: [
            [
                { text: '✏️ Edit Name', callback_data: `editTraitValueName_${collectionId}_${traitTypeIndex}_${instanceIndex}` },
                { text: '✏️ Edit Prompt', callback_data: `editTraitValuePrompt_${collectionId}_${traitTypeIndex}_${instanceIndex}` }
            ],
            [
                { text: '✏️ Edit Rarity', callback_data: `editTraitValueRarity_${collectionId}_${traitTypeIndex}_${instanceIndex}` },
                { text: '🗑️ Delete Value', callback_data: `deleteTraitValue_${collectionId}_${traitTypeIndex}_${instanceIndex}` }
            ],
            [{ text: '« Back', callback_data: `editTraitType_${collectionId}_${traitTypeIndex}` }]
        ]
    };

    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}
prefixHandlers['deleteTraitValue_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleDeleteTraitValue(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}
async function handleDeleteTraitValue(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling delete trait value for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);
    const backTo = await StudioManager.removeTraitValue(user, collectionId, traitTypeIndex, valueIndex);
    const { text, reply_markup } = await CollectionMenuBuilder.buildTraitTypesMenu(user, collectionId, backTo);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}
prefixHandlers['editTraitValueName_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValueName(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}
async function handleEditTraitValueName(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value name for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);

    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'editTraitValueName',
        'Please enter the new name for this trait value:',
        {
            traitTypeIndex,
            valueIndex
        }
    );

    await editMessage(messageConfig);
}

prefixHandlers['editTraitValuePrompt_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValuePrompt(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}
async function handleEditTraitValuePrompt(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value prompt for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);

    const messageConfig = await studioAction.setupAction(
        message,
        user, 
        collectionId,
        'editTraitValuePrompt',
        'Please enter the new prompt for this trait value:',
        {
            traitTypeIndex,
            valueIndex
        }
    );

    await editMessage(messageConfig);
}

prefixHandlers['editTraitValueRarity_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValueRarity(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}
async function handleEditTraitValueRarity(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value rarity for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);

    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'editTraitValueRarity',
        'Please enter the new rarity value (between 0 and 1):',
        {
            traitTypeIndex,
            valueIndex
        }
    );

    await editMessage(messageConfig);
}


prefixHandlers['editTraitName_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex] = action.split('_');
    handleEditTraitName(message, user, parseInt(collectionId), parseInt(traitTypeIndex));
}

async function handleEditTraitName(message, user, collectionId, traitTypeIndex) {
    console.log('Handling edit trait type name for user:', user, 'collection:', collectionId, 'traitType:', traitTypeIndex);
    if (!studio[user]) {
        studio[user] = {};
    }
    
    studio[user].pendingAction = {
        action: 'editTraitName',
        collectionId: collectionId,
        traitTypeIndex: traitTypeIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new name for this trait type:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['addTraitValue_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex] = action.split('_');
    handleAddTraitValue(message, user, parseInt(collectionId), parseInt(traitTypeIndex));
}
async function handleAddTraitValue(message, user, collectionId, traitTypeIndex) {
    console.log('Handling add trait value for user:', user, 'collection:', collectionId, 'traitType:', traitTypeIndex);

    const instructionText = 'Please enter the trait value(s) in the following format:\n' +
                          'name|prompt|rarity\n\n' +
                          'Examples:\n' +
                          'Red|vibrant red color|0.3\n' +
                          'Blue|deep blue color|0.3\n' +
                          'Green|forest green|0.4\n\n' +
                          'For empty/null traits, use:\n' +
                          'None|empty|0.2\n' +
                          'Empty|null|0.1\n\n' +
                          'Note:\n' +
                          '- You can add multiple traits by putting each on a new line\n' +
                          '- Prompt and rarity are optional. Default rarity is 0.5\n' +
                          '- Special values for empty traits: "empty", "null", "0", or ""';

    const messageConfig = await studioAction.setupAction(
        message,
        user,
        collectionId,
        'addTraitValue',
        instructionText,
        {
            traitTypeIndex
        }
    );

    await editMessage(messageConfig);
}

prefixHandlers['deleteTrait_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex] = action.split('_');
    handleDeleteTrait(message, user, parseInt(collectionId), parseInt(traitTypeIndex));
}

async function handleDeleteTrait(message, user, collectionId, traitTypeIndex) {
    console.log('Handling delete trait type for user:', user, 'collection:', collectionId, 'traitType:', traitTypeIndex);
    const collection = await getOrLoadCollection(user, collectionId);
    
    // Remove the trait type
    collection.config.traitTypes.splice(traitTypeIndex, 1);
    
    // Save the changes
    await collectionDB.saveStudio(collection);
    
    // Return to trait types menu
    const { text, reply_markup } = await CollectionMenuBuilder.buildTraitTypesMenu(user, collectionId);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

prefixHandlers['collectionConsult_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleConsultMenu(message, user, collectionId);
}

async function handleConsultMenu(message, user, collectionId) {
    console.log('Handling consult menu for user:', user, 'collection:', collectionId);
    const chatId = message.chat.id;
    const messageId = message.message_id;

    const reply_markup = {
        inline_keyboard: [
            [{ text: '↖︎', callback_data: `ec_${collectionId}` }],
            [{ text: 'Expand master prompt / trait types', callback_data: `consultExpand_${collectionId}_master` }],
            [{ text: 'Expand trait values', callback_data: `consultExpand_${collectionId}_values` }]
        ]
    };

    await editMessage({
        chat_id: chatId,
        message_id: messageId,
        text: '🤖 AI Consultation Options\n\nChoose what you would like help expanding:',
        reply_markup
    });

    setUserState(message, STATES.IDLE);
}

prefixHandlers['consultExpand_'] = (action, message, user) => {
    const [_, collectionId, type] = action.split('_');
    handleConsultExpand(message, user, parseInt(collectionId), type);
}

async function handleConsultExpand(message, user, collectionId, type) {
    console.log('Handling consult expand for user:', user, 'collection:', collectionId, 'type:', type);
    const chatId = message.chat.id;
    const messageId = message.message_id;

    const warningText = '🤖 AI Consultation Service\n\n' +
        'This service uses AI to enhance your collection by:\n' +
        '• Expanding your trait types and values\n' +
        '• Enriching your master prompt\n' +
        '• Adding creative variations\n\n' +
        '⚠️ Important Notes:\n' +
        '• This process will cost 50 charge\n' +
        '• Results are AI-generated suggestions\n' +
        '• You can review and remove any unwanted changes\n' +
        '• The goal is to give your collection more depth and variety\n\n' +
        'Would you like to proceed?';

    const reply_markup = {
        inline_keyboard: [
            [{ text: '↖︎ Back', callback_data: `consult_${collectionId}` }],
            [{ text: '✨ Yes, enhance my collection (50 charge)', callback_data: `consultConfirm_${collectionId}_${type}` }]
        ]
    };

    await editMessage({
        chat_id: chatId,
        message_id: messageId,
        text: warningText,
        reply_markup
    });

    setUserState(message, STATES.IDLE);

}

prefixHandlers['consultConfirm_'] = (action, message, user) => {
    const [_, collectionId, type] = action.split('_');
    handleConsultConfirm(message, user, parseInt(collectionId), type);
}

async function handleConsultConfirm(message, user, collectionId, type) {
    console.log('Handling consult confirm for user:', user, 'collection:', collectionId, 'type:', type);
    // Check if user has enough qoints
    if (!lobby[user].qoints || lobby[user].qoints < 50) {
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: '❌ Insufficient charge!\n\nYou need 50 charge to use the AI consultation service.\n\nCurrent balance: ' + (lobby[user].qoints || 0) + ' charge',
            reply_markup: {
                inline_keyboard: [
                    [{text: 'Add Charge ⚡️', url: 'https://miladystation2.net/charge'}],
                    [{text: '↖︎ Back', callback_data: `consult_${collectionId}`}]
                ]
            }
        });
        return;
    }

    if (!studio[user]) {
        studio[user] = {};
    }
    
    // Set pending action
    studio[user].pendingAction = {
        action: 'consultAI',
        collectionId: collectionId,
        type: type
    };

    // Update message and set state
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please describe what you would like to enhance about your collection:\n\n' +
              '• For master prompt improvements, describe the style/mood/details you want to add\n' +
              '• For new trait types, describe what kind of traits you want to add\n' +
              '• For general improvements, describe your vision for the collection\n\n' +
              'Be as specific as possible to get the best AI suggestions!',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
    console.log('user state', lobby[user].state);
    console.log('studio', studio[user]);
}
async function handleConsultAI(message, user, collectionId) {
    console.log('Handling consult AI for user:', user, 'collection:', collectionId);
    console.log('Current studio state:', studio[user]?.pendingAction);
    await react(message, '🍓');
    try {
        const collection = await getOrLoadCollection(user, collectionId);
        
        // Check if this is a values consultation
        if (studio[user]?.pendingAction?.type === 'values') {
            console.log('Entering values consultation path');
            try {
                // First, determine which trait types to expand
                const traitTypeMessages = [
                    {
                        role: "system",
                        content: `Analyze the user's request and determine which trait types they want to expand.
                        Return ONLY a JSON array of trait type titles that match their request.
                        Available trait types: ${collection.config.traitTypes.map(t => t.title).join(', ')}`
                    },
                    {
                        role: "user",
                        content: message.text
                    }
                ];

                const traitTypeResult = await gptAssist({
                    messages: traitTypeMessages,
                    formatResult: formatters.json
                });
                console.log('Trait type result:', traitTypeResult);

                // IMPORTANT: Only look at the result array, not the entire response
                if (!traitTypeResult?.result?.length) {
                    await sendMessage(message, "I couldn't determine which trait types you want to expand. Please specify which traits you'd like to add values to.");
                    return;
                }

                // Find indexes for matched trait types
                const traitIndexes = traitTypeResult.result
                    .map(title => collection.config.traitTypes.findIndex(t => t.title.toLowerCase() === title.toLowerCase()))
                    .filter(index => index !== -1);
                console.log('Found trait indexes:', traitIndexes);

                if (!traitIndexes.length) {
                    await sendMessage(message, "None of the specified trait types were found in your collection.");
                    return;
                }

                // Initialize proposed changes specifically for trait values
                if (!studio[user].proposedChanges) {
                    studio[user].proposedChanges = {};
                }
                studio[user].proposedChanges[collectionId] = { traitValues: {} };

                // Generate new values for each matched trait type
                for (const traitTypeIndex of traitIndexes) {
                    const traitType = collection.config.traitTypes[traitTypeIndex];
                    console.log('Generating values for trait type:', traitType.title);
                    
                    const valuesResult = await gptAssist({
                        messages: [
                            {
                                role: "system",
                                content: `Generate new trait values that complement the existing ones.
                                Return ONLY a JSON array of new traits in format:
                                [
                                    {
                                        "name": "trait name",
                                        "prompt": "prompt text", 
                                        "rarity": 0.5
                                    }
                                ]`
                            },
                            {
                                role: "user",
                                content: `Trait type: ${traitType.title}\nExisting traits: ${JSON.stringify(traitType.traits)}\nRequest: ${message.text}`
                            }
                        ],
                        formatResult: formatters.json
                    });
                    console.log('Values generated:', valuesResult);

                    if (valuesResult?.result) {
                        studio[user].proposedChanges[collectionId].traitValues[traitTypeIndex] = {
                            title: traitType.title,
                            newValues: valuesResult.result
                        };
                    }
                }

                // Show ONLY the new trait values
                let text = "Here are my suggested new trait values:\n\n";
                Object.entries(studio[user].proposedChanges[collectionId].traitValues).forEach(([index, data]) => {
                    text += `${data.title}:\n`;
                    data.newValues.forEach(trait => {
                        text += `- ${trait.name} (${trait.prompt})\n`;
                    });
                    text += '\n';
                });
                text += "Would you like to add these new trait values?";

                const reply_markup = {
                    inline_keyboard: [
                        [
                            { text: '✅ Add Values', callback_data: `confirmAIChange_${collectionId}_traitValues` },
                            { text: '❌ Skip', callback_data: `cancelAIChange_${collectionId}_traitValues` }
                        ]
                    ]
                };

                await sendMessage(message, text, { reply_markup });
                return;
            } catch (valuesError) {
                console.error('Values consultation error:', valuesError);
                await sendMessage(message, "An error occurred while generating trait values. Please try again.");
                return;
            }
        }

        // If we get here, it's not a values consultation
        try {
            // First, determine the user's intent
            const intentMessages = [
                {
                    role: "system",
                    content: `Analyze the user's request and categorize it as one of:
                        MASTERPROMPTIMPROVE - When they want to enhance the style, mood, or overall description without adding new trait types
                        MASTERPROMPTEXPAND - When they want to add entirely new trait type categories
                        TRAITVALUEEXPAND - When they want to add new values to EXISTING trait types (if they mention a specific trait type by name)
                        
                        Available trait types in this collection:
                        ${collection.config.traitTypes.map(t => `• ${t.title}`).join('\n')}
                        
                        Examples:
                        "make it more cyberpunk" -> MASTERPROMPTIMPROVE
                        "add a new category for hairstyles" -> MASTERPROMPTEXPAND
                        "add more background item 1 values" -> TRAITVALUEEXPAND
                        "let's add more items to the accessories trait" -> TRAITVALUEEXPAND
                        
                        If the user mentions an existing trait type by name and wants to add values to it, always use TRAITVALUEEXPAND.
                        Respond ONLY with one of these categories or NOICANT.`
                },
                {
                    role: "user",
                    content: message.text
                }
            ];

            console.log('Determining intent with message:', message.text);
            console.log('Available trait types:', collection.config.traitTypes.map(t => t.title));
            const intentResult = await gptAssist({
                messages: intentMessages,
                formatResult: formatters.raw
            });
            console.log('Intent result:', intentResult);

            if (!intentResult?.result || intentResult.result === 'NOICANT') {
                await sendMessage(message, "I'm sorry, I couldn't understand how to help improve your collection. Please try being more specific about what you'd like to enhance.");
                return;
            }

            console.log('Detected intent:', intentResult.result.trim());
            
            // Continue with specific enhancement logic based on intent...
            switch (intentResult.result.trim()) {
                case 'MASTERPROMPTIMPROVE':
                    console.log('Entering master prompt improvement path');
                    await handleMasterPromptImprovement(message, user, collectionId, collection);
                    break;
                case 'MASTERPROMPTEXPAND':
                    console.log('Entering master prompt expansion path');
                    await handleMasterPromptExpansion(message, user, collectionId, collection);
                    break;
                case 'TRAITVALUEEXPAND':
                    console.log('Entering trait value expansion path');
                    await handleTraitValueExpansion(message, user, collectionId, collection);
                    break;
                default:
                    console.log('No matching intent found');
                    await sendMessage(message, "I couldn't determine how to help. Please try again with more specific instructions.");
            }
        } catch (intentError) {
            console.error('Error in intent processing:', intentError);
            await sendMessage(message, "An error occurred while processing your request. Please try again.");
        }
    } catch (error) {
        console.error('Error in handleConsultAI:', error);
        await sendMessage(message, "An unexpected error occurred. Please try again later.");
    }
}
async function handleMasterPromptImprovement(message, user, collectionId, collection) {
    try {
        const improvementResult = await gptAssist({
            messages: [
                {
                    role: "system",
                    content: `You are an expert at improving NFT collection prompts. 
                    Analyze the master prompt and suggest improvements while keeping the core concept.
                    Return a JSON object in format:
                    {
                        "improvedPrompt": "the improved master prompt",
                        "changes": ["list of main changes made"]
                    }`
                },
                {
                    role: "user",
                    content: `Current master prompt: ${collection.config.masterPrompt}\nImprovement request: ${message.text}`
                }
            ],
            formatResult: formatters.json
        });

        if (!improvementResult?.result?.improvedPrompt) {
            await sendMessage(message, "I wasn't able to generate improvements for the master prompt. Please try again with more specific instructions.");
            return;
        }

        // Initialize proposed changes if needed
        if (!studio[user].proposedChanges) {
            studio[user].proposedChanges = {};
        }
        studio[user].proposedChanges[collectionId] = {
            masterPrompt: {
                before: collection.config.masterPrompt,
                after: improvementResult.result.improvedPrompt
            }
        };

        // Show the proposed changes
        let text = "Here are my suggested improvements to the master prompt:\n\n";
        text += "Changes made:\n";
        improvementResult.result.changes.forEach(change => {
            text += `• ${change}\n`;
        });
        text += "\nNew master prompt:\n";
        text += `${improvementResult.result.improvedPrompt}\n\n`;
        text += "Would you like to apply these changes?";

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: '✅ Apply Changes', callback_data: `confirmAIChange_${collectionId}_masterPrompt` },
                    { text: '❌ Skip', callback_data: `cancelAIChange_${collectionId}_masterPrompt` }
                ]
            ]
        };

        await sendMessage(message, text, { reply_markup });

    } catch (error) {
        console.error('Error in master prompt improvement:', error);
        await sendMessage(message, "An error occurred while improving the master prompt. Please try again.");
    }
}

async function handleMasterPromptExpansion(message, user, collectionId, collection) {
    try {
        const expansionResult = await gptAssist({
            messages: [
                {
                    role: "system",
                    content: `You are an expert at expanding NFT collection concepts.
                    Analyze the current configuration and suggest new trait types and master prompt additions.
                    Return a JSON object in format:
                    {
                        "masterPrompt": "expanded master prompt",
                        "traitTypes": [
                            {
                                "title": "trait type name",
                                "traits": [
                                    {
                                        "name": "trait name",
                                        "prompt": "prompt text",
                                        "rarity": 0.5
                                    }
                                ]
                            }
                        ]
                    }`
                },
                {
                    role: "user",
                    content: `Current configuration:
                    Master prompt: ${collection.config.masterPrompt}
                    Current trait types: ${JSON.stringify(collection.config.traitTypes)}
                    Expansion request: ${message.text}`
                }
            ],
            formatResult: formatters.json
        });

        if (!expansionResult?.result?.masterPrompt || !expansionResult?.result?.traitTypes) {
            await sendMessage(message, "I wasn't able to generate expansion suggestions. Please try again with more specific instructions.");
            return;
        }

        // Initialize proposed changes
        if (!studio[user].proposedChanges) {
            studio[user].proposedChanges = {};
        }
        studio[user].proposedChanges[collectionId] = {
            masterPrompt: {
                before: collection.config.masterPrompt,
                after: expansionResult.result.masterPrompt
            },
            traitTypes: {
                before: collection.config.traitTypes,
                after: [...collection.config.traitTypes, ...expansionResult.result.traitTypes]
            }
        };

        // Show the proposed changes
        let text = "Here are my suggested expansions:\n\n";
        text += "New trait types:\n";
        expansionResult.result.traitTypes.forEach(traitType => {
            text += `• ${traitType.title} with ${traitType.traits.length} values\n`;
        });
        text += "\nUpdated master prompt:\n";
        text += `${expansionResult.result.masterPrompt}\n\n`;
        text += "Would you like to apply these changes?";

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: '✅ Apply Changes', callback_data: `confirmAIChange_${collectionId}_expansion` },
                    { text: '❌ Skip', callback_data: `cancelAIChange_${collectionId}_expansion` }
                ]
            ]
        };

        await sendMessage(message, text, { reply_markup });

    } catch (error) {
        console.error('Error in master prompt expansion:', error);
        await sendMessage(message, "An error occurred while expanding the collection. Please try again.");
    }
}

async function handleTraitValueExpansion(message, user, collectionId, collection) {
    try {
        // First determine which trait types to expand
        const traitTypeResult = await gptAssist({
            messages: [
                {
                    role: "system",
                    content: `Analyze the user's request and determine which trait types they want to expand.
                    Return ONLY a JSON array of trait type titles that match their request.
                    Available trait types: ${collection.config.traitTypes.map(t => t.title).join(', ')}`
                },
                {
                    role: "user",
                    content: message.text
                }
            ],
            formatResult: formatters.json
        });

        if (!traitTypeResult?.result?.length) {
            await sendMessage(message, "I couldn't determine which trait types you want to expand. Please specify which traits you'd like to add values to.");
            return;
        }

        // Find indexes for matched trait types
        const traitIndexes = traitTypeResult.result
            .map(title => collection.config.traitTypes.findIndex(t => t.title.toLowerCase() === title.toLowerCase()))
            .filter(index => index !== -1);

        if (!traitIndexes.length) {
            await sendMessage(message, "None of the specified trait types were found in your collection.");
            return;
        }

        // Initialize proposed changes
        if (!studio[user].proposedChanges) {
            studio[user].proposedChanges = {};
        }
        studio[user].proposedChanges[collectionId] = { traitValues: {} };

        // Generate new values for each trait type
        for (const traitTypeIndex of traitIndexes) {
            const traitType = collection.config.traitTypes[traitTypeIndex];
            
            const valuesResult = await gptAssist({
                messages: [
                    {
                        role: "system",
                        content: `Generate new trait values that complement the existing ones.
                        Return ONLY a JSON array of new traits in format:
                        [
                            {
                                "name": "trait name",
                                "prompt": "prompt text", 
                                "rarity": 0.5
                            }
                        ]`
                    },
                    {
                        role: "user",
                        content: `Trait type: ${traitType.title}\nExisting traits: ${JSON.stringify(traitType.traits)}\nRequest: ${message.text}`
                    }
                ],
                formatResult: formatters.json
            });

            if (valuesResult?.result) {
                studio[user].proposedChanges[collectionId].traitValues[traitTypeIndex] = {
                    title: traitType.title,
                    newValues: valuesResult.result
                };
            }
        }

        // Show the proposed new values
        let text = "Here are my suggested new trait values:\n\n";
        Object.entries(studio[user].proposedChanges[collectionId].traitValues).forEach(([index, data]) => {
            text += `${data.title}:\n`;
            data.newValues.forEach(trait => {
                text += `- ${trait.name} (${trait.prompt})\n`;
            });
            text += '\n';
        });
        text += "Would you like to add these new trait values?";

        const reply_markup = {
            inline_keyboard: [
                [
                    { text: '✅ Add Values', callback_data: `confirmAIChange_${collectionId}_traitValues` },
                    { text: '❌ Skip', callback_data: `cancelAIChange_${collectionId}_traitValues` }
                ]
            ]
        };

        await sendMessage(message, text, { reply_markup });

    } catch (error) {
        console.error('Error in trait value expansion:', error);
        await sendMessage(message, "An error occurred while expanding trait values. Please try again.");
    }
}

// Add these new handlers
prefixHandlers['confirmAIChange_'] = (action, message, user) => {
    const [_, collectionId, changeType] = action.split('_');
    handleConfirmAIChange(message, user, parseInt(collectionId), changeType);
}

prefixHandlers['cancelAIChange_'] = (action, message, user) => {
    const [_, collectionId, changeType] = action.split('_');
    handleSkipAIChange(message, user, parseInt(collectionId), changeType);
}

async function handleConfirmAIChange(message, user, collectionId, changeType) {
    const proposedChange = studio[user]?.proposedChanges?.[collectionId];
    if (!proposedChange) {
        await sendMessage(message, "No pending changes found.");
        return;
    }

    let changes = false;
    
    // Deduct qoints for the AI consultation
    lobby[user].qoints -= 50;
    await userCore.writeUserDataPoint(user, 'qoints', lobby[user].qoints);
    
    switch (changeType) {
        case 'masterPrompt':
            if (proposedChange.masterPrompt) {
                studio[user][collectionId].config.masterPrompt = proposedChange.masterPrompt.after;
                changes = true;
            }
            break;
            
        case 'traitTypes':
            if (proposedChange.traitTypes) {
                studio[user][collectionId].config.traitTypes = proposedChange.traitTypes.after;
                changes = true;
            }
            break;
            
        case 'traitValues':
            if (proposedChange.traitValues) {
                Object.entries(proposedChange.traitValues).forEach(([traitTypeIndex, data]) => {
                    if (!studio[user][collectionId].config.traitTypes[traitTypeIndex].traits) {
                        studio[user][collectionId].config.traitTypes[traitTypeIndex].traits = [];
                    }
                    studio[user][collectionId].config.traitTypes[traitTypeIndex].traits.push(...data.newValues);
                });
                changes = true;
            }
            break;
    }

    if (changes) {
        // Save the changes
        await collectionDB.saveStudio(studio[user][collectionId]);
        await sendMessage(message, `${changeType} changes have been saved!`);
    }

    // Clean up only the specific change type
    if (proposedChange[changeType]) {
        delete proposedChange[changeType];
    }
    
    // If no more changes pending, remove the entire proposedChanges object
    if (Object.keys(proposedChange).length === 0) {
        delete studio[user].proposedChanges[collectionId];
    }

    await handleCollectionMenu(message, user, collectionId);
}

async function handleSkipAIChange(message, user, collectionId, changeType) {
    const proposedChange = studio[user].proposedChanges?.[collectionId];
    if (proposedChange) {
        // Remove only the specific change type
        if (proposedChange[changeType]) {
            delete proposedChange[changeType];
        }
        
        // If no more changes pending, remove the entire proposedChanges object
        if (Object.keys(proposedChange).length === 0) {
            delete studio[user].proposedChanges[collectionId];
        }
    }
    
    await sendMessage(message, `${changeType} changes have been skipped.`);
    await handleCollectionMenu(message, user, collectionId);
}

function processPromptWithOptionals(masterPrompt, traitValues) {
    let processedPrompt = masterPrompt;
    
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
function findExclusions(masterPrompt) {
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Processing master prompt: ${masterPrompt}`);
    const exclusions = [];
    
    // Updated regex to better handle nested structures
    const exclusionRegex = /\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\{([^}]+)\}/g;
    let match;

    // Find all exclusion groups in the master prompt
    while ((match = exclusionRegex.exec(masterPrompt)) !== null) {
        const content = match[1];
        const exclusionGroup = match[2].split(',').map(trait => trait.trim());
        
        logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found content: "${content}" with exclusions: ${exclusionGroup.join(', ')}`);
        
        // Find both single and double bracketed traits
        const doubleTraitMatches = content.match(/\[\[([^\]]+)\]\]/g) || [];
        const singleTraitMatches = content.match(/\[([^\[\]\{]+)\]/g) || [];
        const allTraits = [
            ...doubleTraitMatches.map(m => m.slice(2, -2)), // Remove [[ and ]]
            ...singleTraitMatches.map(m => m.slice(1, -1))  // Remove [ and ]
        ];

        if (allTraits.length > 0) {
            allTraits.forEach(targetTrait => {
                logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found target trait: ${targetTrait}`);
                
                // Create exclusion objects for each excluded trait
                exclusionGroup.forEach(exclusion => {
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

    // Clean the master prompt by removing only the exclusion markers while preserving brackets
    const cleanedPrompt = masterPrompt.replace(/\{[^{}]*\}/g, '');
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Cleaned prompt: ${cleanedPrompt}`);
    logThis(LOG_EXCLUSION, `[EXCLUSIONS] Found ${exclusions.length} total exclusions`);

    return {
        exclusions,
        cleanedPrompt
    };
}

// === Cook Mode Components ===

class CollectionDatabase {
    // Store collection progress, images, and metadata
    async saveGeneratedPiece(collectionId, pieceData) {
        // Save generated image and metadata to database
        // Track generation attempts and status
    }

    async getCollectionProgress(collectionId) {
        // Return progress stats:
        // - Total pieces generated
        // - Pieces approved/rejected
        // - Remaining to generate
    }

    async markPieceForRegeneration(pieceId) {
        // Increment iteration number
        // Set status to 'pending_regeneration'
    }

}

class GenerationController {
    constructor(database, promptGenerator, metadataGenerator) {
        this.database = database;
        this.promptGenerator = promptGenerator;
        this.metadataGenerator = metadataGenerator;
        this.isRunning = false;
    }

    async startCookMode(collectionId) {
        // Initialize cook mode for collection
        // Start generation loop
    }

    async generationLoop() {
        while (this.isRunning) {
            // Check conditions:
            // - Collection not complete
            // - Cook mode active
            // - User has enough charge
            
            // If all pass:
            // 1. Generate metadata and prompt
            // 2. Request image generation
            // 3. Save results to database
            // 4. Update progress
            // 5. Emit status update
        }
    }

    pauseCookMode() {
        // Pause generation loop
    }
}

class MetadataGenerator {
    generatePieceMetadata(collection, pieceNumber, traits) {
        const metadata = {
            name: this.formatName(collection.nameFormat, pieceNumber),
            description: collection.descriptionTemplate,
            image: this.formatImageUrl(collection.imagePrefix, pieceNumber)
        };

        // Add standard-specific fields
        switch(collection.standard) {
            case 'metaplex':
                metadata.external_url = collection.externalUrl;
                metadata.properties = this.generateMetaplexProperties(collection, pieceNumber);
                break;
            case 'erc721':
            case 'erc1155':
                metadata.number = pieceNumber;
                break;
        }

        // Add attributes
        metadata.attributes = this.generateAttributes(collection, traits);

        return metadata;
    }

    generateAttributes(collection, traits) {
        const attributes = [];
        
        // Convert traits to attributes
        Object.entries(traits).forEach(([trait_type, value]) => {
            const attribute = { trait_type, value };
            
            // Add rarity if configured
            if (collection.attributeConfig.includeRarity) {
                attribute.rarity = this.calculateRarity(collection, trait_type, value);
            }
            
            attributes.push(attribute);
        });

        // Add any custom static attributes
        if (collection.attributeConfig.customAttributes) {
            attributes.push(...collection.attributeConfig.customAttributes);
        }

        return attributes;
    }
}

class StatusManager {
    constructor(database) {
        this.database = database;
    }

    async updateStatus(collectionId) {
        // Get latest progress from database
        // Format status message
        // Update user's status message
    }
}

class CurationManager {
    async showPieceCuration(collectionId, pieceId) {
        // Display piece with approval interface
        // Options:
        // - Approve
        // - Reject (mark for regeneration)
        // - Skip to next
    }

    async handleBatchDownload(collectionId, startId, endId) {
        // Package and deliver batch of approved pieces
    }
}

class CookModeHandler {
    constructor() {
        this.database = new CollectionDatabase();
        this.metadataGenerator = new MetadataGenerator();
        this.generator = new GenerationController(
            this.database,
            this.promptGenerator,
            this.metadataGenerator
        );
        this.statusManager = new StatusManager(this.database);
        this.curator = new CurationManager();
    }

    async initializeCookMode(message, user, collectionId) {
        // Verify collection is ready for cooking:
        // - Has valid master prompt
        // - Has trait types defined
        // - Has metadata configured
        
        // If ready:
        // 1. Initialize database entries
        // 2. Start generation controller
        // 3. Set up status message
        // 4. Return cook mode control interface
    }
}


const metadataSchema = {
    // Base Fields (Common across all)
    name: String,                 // Required for all
    description: String,          // Required for all
    image: String,                // Primary image URL
    
    // Solana-specific
    external_url: String,         // Optional, Solana
    properties: {                 // Optional, Solana
        files: [{
            uri: String,
            type: String
        }],
        category: String
    },
    
    // Ethereum-specific
    number: Number,               // Optional, common in ETH
    
    // Common but flexible attributes
    attributes: [{
        trait_type: String,
        value: String,
        // Optional fields some platforms use
        display_type: String,     // For numerical displays
        max_value: Number,        // For numerical traits
        rarity: Number           // For rarity scores
    }],
    
    // Metadata format identifier
    standard: String,            // 'metaplex', 'erc721', 'erc1155'
}

const collectionMetadataConfig = {
    standard: String,            // Which standard to use
    nameFormat: String,         // e.g., "Collection Name #{{number}}"
    descriptionTemplate: String,
    externalUrl: String,        // For Solana
    imagePrefix: String,        // Base URL/IPFS prefix
    includeProperties: Boolean, // Whether to include Solana properties
    propertyDefaults: {
        category: String,
        fileType: String
    },
    attributeConfig: {
        includeRarity: Boolean,
        includeDisplayTypes: Boolean,
        customAttributes: [{     // Additional static attributes
            trait_type: String,
            value: String
        }]
    }
}

// Add cook mode command handlers
prefixHandlers['cook_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleCookMode(message, user, collectionId);
}

async function handleCookMode(message, user, collectionId) {
    const cookMode = new CookModeHandler();
    await cookMode.initializeCookMode(message, user, collectionId);
}


