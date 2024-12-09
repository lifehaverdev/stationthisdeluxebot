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
    react 
} = require('../../utils')
const { 
    createCollection,
    loadCollection,
    writeUserDataPoint,
    deleteStudio,
    saveStudio,
 } = require('../../../db/mongodb')
 const { gptAssist, formatters } = require('../../../commands/assist');
 const fs = require('fs')
 const { checkIn } = require('../gatekeep')

/*


*/
async function getMyCollections(userId) {
    //console.log('getting collections')
    let collectionKeyboardOptions = [];
    //console.log(lobby[userId])
    if (lobby[userId]?.collections?.length > 0) {
        
        for (const collectionIdHash of lobby[userId].collections) {
            console.log('made it in',collectionIdHash)    
            try {
                const collectionInfo = await getOrLoadCollection(userId,collectionIdHash);
                collectionKeyboardOptions.push([{ text: `${collectionInfo.name}`, callback_data: `ec_${collectionIdHash}` }]);
            } catch (error) {
                console.error(`Failed to load collection with ID ${collectionIdHash}:`, error);
                delete lobby[userId].collections[collectionIdHash]
                await writeUserDataPoint(userId,'collections',lobby[userId].collections)
                await deleteStudio(collectionIdHash)
            }
        }
    }
    if (lobby[userId]?.collections?.length < 3) {
        collectionKeyboardOptions.push([{ text: '➕', callback_data: 'newcollection' }]);
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
            traitTypes: []
        },
        initiated: Date.now(),
        status: 'incomplete'
    }
    userContext.collections.push(thisCollection.collectionId)
    // Ensure studio[userId] is an object
    if (!studio.hasOwnProperty(userId)) {
        studio[userId] = {};
    }
    studio[userId][thisCollection.collectionId] = thisCollection;
    try {
        const success = await createCollection(thisCollection)
        if(!success){
            await sendMessage(message, 'Collection creation failed');
            return
        }
    } catch (err) {
        console.error('Error during Collection creation:', err);
        await sendMessage(message, 'Collection creation encountered an error.');
        return;
    }
    try {
        const userWriteSuccess = await writeUserDataPoint(parseInt(userId), 'collections',userContext.collections);
        if (!userWriteSuccess) {
            await sendMessage(message, 'Save settings failed, use /savesettings');
        }
    } catch (error) {
        console.error('Error writing user data:', error);
    }
   
    const { text, reply_markup } = await buildCollectionMenu(userId,hashId)
    sendMessage(message, text, { reply_markup })
    setUserState(message,STATES.IDLE)
}

async function handleCollectionMenu(message,user,collectionId) {
    console.log('Entering collection menu for user:', user, 'collection:', collectionId);
    const { text, reply_markup } = await buildCollectionMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id,{reply_markup},text)
    setUserState(message,STATES.IDLE)
}

function calculateCompletionPercentage(collectionData) {
    const { config } = collectionData;
    const traitTypes = config.traitTypes;

    // Handle the case where there are no trait types yet
    if (traitTypes.length === 0) {
        return 0; // 0% completion if no trait types are defined
    }

    // Calculate completion as a percentage based on the number of trait types
    const maxTraitTypes = 10; // 10 trait types means 100% completion
    const currentTraitTypes = traitTypes.length;

    // Calculate the percentage
    const completionPercentage = Math.min((currentTraitTypes / maxTraitTypes) * 100, 100);

    return completionPercentage;
}

async function buildCollectionMenu(userId,collectionId) {
    try {
        const COMPLETION_THRESHOLD = 100
        let collectionData = await getOrLoadCollection(userId,collectionId)
        const { name, status, submitted, config, totalSupply } = collectionData;

        // Calculate total possible combinations
        let totalCombinations = 1;
        if (config.traitTypes && config.traitTypes.length > 0) {
            config.traitTypes.forEach(traitType => {
                if (traitType.traits) {
                    totalCombinations *= traitType.traits.length;
                }
            });
        }

        let menuText = `${name}\nSTATUS: ${status}`;
        
        // Add metadata overview
        menuText += `\n\nMETADATA OVERVIEW:`;
        menuText += `\n• Total Supply: ${totalSupply || 'Not set'}`;
        menuText += `\n• Possible Combinations: ${totalCombinations.toLocaleString()}`;
        if (totalSupply && totalCombinations < totalSupply) {
            menuText += `\n⚠️ Warning: Total supply exceeds possible combinations!`;
        }
        menuText += `\n• Trait Types: ${config.traitTypes?.length || 0}`;
        menuText += `\n• Base URI: ${config.baseURI ? '✓' : '✗'}`;
        menuText += `\n• Description: ${config.description ? '✓' : '✗'}`;
        if (collectionData.chain === 'sol') {
            menuText += `\n• Royalties: ${config.royalties || '0'}%`;
        }

        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000);
            menuText += `\n\nSubmitted: ${timeSinceSubmitted} seconds ago`;
        }

        const inlineKeyboard = [];

        inlineKeyboard.push([{ text: '↖︎', callback_data: `collectionModeMenu` }]);
        inlineKeyboard.push([{ text: 'metadata', callback_data: `collectionMetaData_${collectionId}` }])
        inlineKeyboard.push([{ text: 'config', callback_data: `collectionConfigMenu_${collectionId}` }])
        inlineKeyboard.push([{ text: 'consult', callback_data: `collectionConsult_${collectionId}` }])

        if (!submitted) {
            let completedCount = calculateCompletionPercentage(collectionData);
            
            inlineKeyboard.push(
                [
                    { text: '🗑️', callback_data: `rmc_${collectionId}` },
                    {text: '💾', callback_data: `savec_${collectionId}`}
            ]
            );

            if (completedCount >= COMPLETION_THRESHOLD) {
                inlineKeyboard.push([{ text: 'Submit', callback_data: `sc_${collectionId}` }]);
            }
        }
        
        return {
            text: menuText,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        };
    } catch (error) {
        console.error("Error building collection menu:", error);
        return null;
    }
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
    await saveStudio(studio[user][collectionId]);
    await handleCollectionMenu(message,user,collectionId)
}

async function removeCollection(message,user, collectionId) {
    console.log('Handling remove collection for user:', user, 'collection:', collectionId);
    if (!lobby[user]) {
        console.log(`User ${user} not found in lobby, checking in.`);
        await checkIn({ from: { id: user }, chat: { id: user } });
    }

    // Safely update the user's collections array
    if (lobby[user]?.collections) {
        lobby[user].collections = lobby[user].collections.filter(collection => collection !== collectionId);
    } else {
        console.log(`User ${user} has no collections to remove.`);
    }

    // Remove the collection from the studio
    if (studio.hasOwnProperty(user) && studio[user].hasOwnProperty(collectionId)) {
        delete studio[user][collectionId];
        console.log(`studio entry for collection ${collectionId} removed.`);
    }

    // Delete the collection data from the database and associated files
    await deleteStudio(collectionId);
    await writeUserDataPoint(user,'collections',lobby[user].collections)
    await handleCollectionModeMenu(message,user)
}


async function getOrLoadCollection(userId, collectionId) {
    console.log('userId',userId,'collectionId',collectionId)
    if (studio[userId]?.[collectionId]) {
        console.log(`Using cached collection data for user ${userId}, collection ${collectionId}`);
        return studio[userId][collectionId];
    }

    console.log(`Loading collection data for user ${userId}, collection ${collectionId} from database...`);
    const collectionData = await loadCollection(collectionId);

    if (!collectionData) {
        throw new Error(`collection data not found for ID ${collectionId}`);
    }

    // Initialize studio for the user if necessary
    if (!studio[userId]) {
        studio[userId] = {};
    }

    // Cache the loaded data in the namespaced studio
    studio[userId][collectionId] = collectionData;
    console.log('collection data loaded and cached in studio',studio[userId][collectionId])
    return collectionData;
}


function handlePrefix(action, message, user, actionKey) {
    const collectionId = parseInt(action.split('_')[1]);
    actionMap[actionKey](message, user, collectionId);
}

prefixHandlers[`collectionMetaData_`] = (action, message, user) => handlePrefix(action, message, user, 'collectionMetaData')
actionMap['collectionMetaData'] = handleCollectionMetaData

async function handleCollectionMetaData(message,user,collectionId) {
    console.log('Entering collection metadata menu for user:', user, 'collection:', collectionId);
    const { text, reply_markup } = await buildCollectionMetaDataMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id, { reply_markup }, text)
}

async function buildCollectionMetaDataMenu(user, collectionId) {
    const collection = await getOrLoadCollection(user, collectionId);
    
    const text = `Collection Metadata for ${collection.name}\n\n` +
                 `Supply: ${collection.totalSupply || 'Not set'}\n` +
                 `Chain: ${collection.chain || 'Not set'}\n` + 
                 `${collection.chain === 'sol' ? `Royalties: ${collection.royalties || '0'}%\n` : ''}`;

    return {
        text,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Set Supply', callback_data: `supply_${collectionId}` },
                    { text: '⛓️ Set Chain', callback_data: `chain_${collectionId}` }
                ],
                [
                    { text: '📝 Set Description', callback_data: `description_${collectionId}` },
                    { text: '✏️ Set Edition Title', callback_data: `editionTitle_${collectionId}` }
                ],
                ...(studio[user][collectionId].chain === 'sol' ? [
                    [{ text: '💰 Set Royalties', callback_data: `royalty_${collectionId}` }]
                ] : []),
                [
                    { text: '« Back', callback_data: `ec_${collectionId}` }
                ]
            ]
        }
    }
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
    console.log('handle set supply',message,user,collectionId)
    if (!studio[user]) {
        studio[user] = {};
    }
    
    // Set pending action
    studio[user].pendingAction = {
        action: 'supply',
        collectionId: collectionId
    };

    // Update message and set state
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the total supply for your collection:',
    });
    

    setUserState({...message,from: {id: user},chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
    console.log('user state',lobby[user].state)
    console.log('studio',studio[user])
}

async function handleSetRoyalty(message,user,collectionId) {
    console.log('handle set royalty',message,user,collectionId)
    if (!studio[user]) {
        studio[user] = {};
    }
    
    // Set pending action
    studio[user].pendingAction = {
        action: 'royalty',
        collectionId: collectionId
    };

    // Update message and set state
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the royalty percentage 0-100 for your collection:',
    });
    

    setUserState({...message,from: {id: user},chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
    console.log('user state',lobby[user].state)
    console.log('studio',studio[user])
}

async function handleSetEditionTitle(message,user,collectionId) {
    console.log('handle set edition title',message,user,collectionId)
    if (!studio[user]) {
        studio[user] = {};
    }
    
    // Set pending action
    studio[user].pendingAction = {
        action: 'editionTitle',
        collectionId: collectionId
    };

    // Update message and set state
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the edition title for your collection pieces:\n\n(e.g. "Milady "2344 or "#"2344 or "Milady #"2344)',
    });
    

    setUserState({...message,from: {id: user},chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
    console.log('user state',lobby[user].state)
    console.log('studio',studio[user])
}

async function handleSetDescription(message,user,collectionId) {
    console.log('handle set description',message,user,collectionId)
    if (!studio[user]) {
        studio[user] = {};
    }
    
    // Set pending action
    studio[user].pendingAction = {
        action: 'description',
        collectionId: collectionId
    };

    // Update message and set state
    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the description for your collection metadata:',
    });
    

    setUserState({...message,from: {id: user},chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
    console.log('user state',lobby[user].state)
    console.log('studio',studio[user])
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
    await saveStudio(studio[user][collectionId]);
    //delete studio[user].pendingAction;
    setUserState(message, STATES.IDLE);
    await handleCollectionMenu(message,user,collectionId)
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
                                    studio[userId][collectionId].totalSupply = supply;
                                    backTo = 'metadata'
                                    break;
                                case 'royalty':
                                    const royalty = parseInt(userInput);
                                    if (isNaN(royalty) || royalty < 0 || royalty > 100) {
                                        await sendMessage(message, 'Please enter a valid number between 0 and 100');
                                        return;
                                    }
                                    studio[userId][collectionId].royalties = royalty;
                                    backTo = 'metadata'
                                    break;
                                case 'editionTitle':
                                    studio[userId][collectionId].editionTitle = message.text
                                    backTo = 'metadata'
                                    break;
                                case 'description':
                                    studio[userId][collectionId].description = message.text
                                    backTo = 'metadata'
                                    break;
                                case 'editMasterPrompt':
                                    console.log('edit master prompt', message, userId, collectionId)
                                    const masterPrompt = message.text
                                    studio[userId][collectionId].config.masterPrompt = masterPrompt
                                    backTo = 'config'
                                    break;
                                case 'addTrait':
                                    const traitType = {
                                        title: message.text,
                                        traits: [] // Array to hold trait instances
                                    };
                                    studio[userId][collectionId].config.traitTypes.push(traitType);
                                    backTo = 'traitTypes'
                                    break;
                                case 'editTraitName':
                                    const newTraitName = message.text;
                                    const oldTraitName = studio[userId][collectionId].config.traitTypes[traitTypeIndex].title;
                                    
                                    // Update trait type title
                                    studio[userId][collectionId].config.traitTypes[traitTypeIndex].title = newTraitName;
                                    
                                    // Update master prompt placeholders
                                    studio[userId][collectionId].config.masterPrompt = 
                                        studio[userId][collectionId].config.masterPrompt.replace(
                                            `[[${oldTraitName}]]`, 
                                            `[[${newTraitName}]]`
                                        );
                                    
                                    backTo = 'traitTypes'
                                    break;
                                case 'editWorkflow':
                                    const workflow = message.text;
                                    const validWorkflows = ['FLUX','MAKE', 'MAKE3']
                                    if(!validWorkflows.includes(workflow)){
                                        await sendMessage(message, 'Please enter a valid workflow type: FLUX MAKE or MAKE3');
                                        return;
                                    }
                                    studio[userId][collectionId].config.workflow = workflow;
                                    backTo = 'config'
                                    break;
                                case 'addTraitValue':
                                    console.log('trait types', JSON.stringify(studio[userId][collectionId].config));
                                    console.log('pending action:', JSON.stringify(studio[userId].pendingAction));

                                    // Split input by newlines to handle multiple traits
                                    const traitInputs = message.text.split('\n');

                                    // Initialize traits array if needed
                                    if (!studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits) {
                                        console.log('traits array was empty, initializing')
                                        studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits = [];
                                    }

                                    // Process each trait input
                                    for (const traitInput of traitInputs) {
                                        try {
                                            // Parse the trait value input in format "name|prompt|rarity"
                                            const [name, prompt, rarity] = traitInput.split('|').map(s => s.trim());

                                            if (!name) continue; // Skip if name is empty

                                            const newTrait = {
                                                name: name,
                                                prompt: prompt || name, // Use name as prompt if no prompt provided
                                                rarity: parseFloat(rarity) || 0.5 // Default 50% rarity if not specified
                                            };

                                            console.log('Adding trait:', JSON.stringify(newTrait));
                                            studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits.push(newTrait);
                                        } catch (err) {
                                            console.log('Error parsing trait input:', traitInput, err);
                                            // If this is the first/only trait and it failed, we might want to notify the user
                                            if (traitInputs.length === 1) {
                                                throw err; // This will be caught by the outer error handler
                                            }
                                            // Otherwise continue processing other traits
                                            continue;
                                        }
                                    }

                                    console.log('traits array after:', JSON.stringify(studio[userId][collectionId].config.traitTypes[traitTypeIndex].traits));
                                    backTo = 'traitTypes'
                                    break;
                                case 'editTraitValueName':
                                    const { traitTypeIndex: nameTypeIndex, valueIndex: nameValueIndex } = studio[userId].pendingAction;
                                    studio[userId][collectionId].config.traitTypes[nameTypeIndex].traits[nameValueIndex].name = message.text;
                                    backTo = 'traitTypes';
                                    break;

                                case 'editTraitValuePrompt':
                                    const { traitTypeIndex: promptTypeIndex, valueIndex: promptValueIndex } = studio[userId].pendingAction;
                                    studio[userId][collectionId].config.traitTypes[promptTypeIndex].traits[promptValueIndex].prompt = message.text;
                                    backTo = 'traitTypes';
                                    break;

                                case 'editTraitValueRarity':
                                    const { traitTypeIndex: rarityTypeIndex, valueIndex: rarityValueIndex } = studio[userId].pendingAction;
                                    const newRarity = parseFloat(message.text);
                                    if (isNaN(newRarity) || newRarity < 0) {
                                        await sendMessage(message, 'Please enter a valid positive number for rarity');
                                        return;
                                    }
                                    studio[userId][collectionId].config.traitTypes[rarityTypeIndex].traits[rarityValueIndex].rarity = newRarity;
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
    await saveStudio(studio[userId][collectionId]);
    delete studio[userId].pendingAction;
    setUserState(message, STATES.IDLE);
    
    // Return to metadata menu
    if(backTo === 'metadata'){
        const { text, reply_markup } = await buildCollectionMetaDataMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    } else if (backTo === 'config') {
        const { text, reply_markup } = await buildCollectionConfigMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    } else if (backTo === 'traitTypes') {
        const { text, reply_markup } = await buildTraitTypesMenu(userId, collectionId);
        await sendMessage(message, text, { reply_markup });
    }
}

prefixHandlers['collectionConfigMenu_'] = (action, message, user) => handlePrefix(action, message, user, 'collectionConfigMenu')
actionMap['collectionConfigMenu'] = handleCollectionConfigMenu
async function handleCollectionConfigMenu(message,user,collectionId) {
    console.log('Entering collection config menu for user:', user, 'collection:', collectionId);
    console.log('handle collection config menu',message,user,collectionId)
    const { text, reply_markup } = await buildCollectionConfigMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id, { reply_markup }, text)
    setUserState(message,STATES.IDLE)
}

async function buildCollectionConfigMenu(user,collectionId) {
    console.log('build collection config menu',user,collectionId)
    const collection = await getOrLoadCollection(user,collectionId)
    const { config } = collection
    const { masterPrompt, traitTypes } = config

    // Calculate total combinations and analyze traits
    let totalCombinations = 1;
    let traitAnalysis = [];
    
    traitTypes.forEach(trait => {
        if (trait.traits && trait.traits.length > 0) {
            totalCombinations *= trait.traits.length;
            
            // Calculate average rarity for this trait type
            const avgRarity = trait.traits.reduce((sum, t) => sum + (t.rarity || 0.5), 0) / trait.traits.length;
            
            traitAnalysis.push(
                `- ${trait.title}: ${trait.traits.length} values (avg rarity: ${avgRarity.toFixed(2)})`
            );
        } else {
            traitAnalysis.push(`- ${trait.title}: No values yet`);
        }
    });

    const text = `Collection Config for ${collection.name}\n\n` +
                 `Master Prompt: ${masterPrompt}\n\n` +
                 `Trait Analysis:\n${traitAnalysis.join('\n')}\n\n` +
                 `Total Possible Combinations: ${totalCombinations.toLocaleString()}\n` +
                 `${totalCombinations > 10000 ? '⚠️ Warning: Large number of combinations may impact generation time' : ''}`;

    return {
        text,
        reply_markup: {
            inline_keyboard: [
                [{ text: '« Back', callback_data: `ec_${collectionId}` }],
                [{ text: 'Edit Master Prompt', callback_data: `editMasterPrompt_${collectionId}` }],
                [{ text: 'Edit Trait Tree', callback_data: `editTraitTypes_${collectionId}` }],
                [{ text: 'Workflow', callback_data: `editWorkflow_${collectionId}` }],
                [{ text: 'Test', callback_data: `testCollection_${collectionId}` }]
            ]
        }
    }
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
async function handleTestCollection(message,user,collectionId) {
    console.log('Handling test collection for user:', user, 'collection:', collectionId);
    console.log('Handling test collection for user:', user, 'collection:', collectionId);
    const collection = await getOrLoadCollection(user, collectionId);
    
    // Get master prompt and trait types
    const { masterPrompt, traitTypes } = collection.config;
    
    if (!masterPrompt || !traitTypes || traitTypes.length === 0) {
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: "Cannot test - collection needs a master prompt and trait types configured first"
        });
        return;
    }

    // Select random trait values based on rarity weights
    let selectedTraits = {};
    traitTypes.forEach(traitType => {
        if (!traitType.traits || traitType.traits.length === 0) return;
        
        // Calculate total weight
        const totalWeight = traitType.traits.reduce((sum, trait) => sum + (trait.rarity || 1), 0);
        
        // Generate random number between 0 and total weight
        let random = Math.random() * totalWeight;
        
        // Find the trait that corresponds to this random value
        let selectedTrait = traitType.traits[0];
        for (const trait of traitType.traits) {
            random -= (trait.rarity || 1);
            if (random <= 0) {
                selectedTrait = trait;
                break;
            }
        }
        
        selectedTraits[traitType.title] = selectedTrait.prompt;
    });

    // Replace placeholders in master prompt with selected trait values
    let testPrompt = masterPrompt;
    Object.entries(selectedTraits).forEach(([title, prompt]) => {
        const placeholder = `[[${title}]]`;
        testPrompt = testPrompt.replace(placeholder, prompt);
    });

    const prefix = collection.config.workflow.toLowerCase()

    // Display the test prompt
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
}

prefixHandlers['editMasterPrompt_'] = (action, message, user) => handlePrefix(action, message, user, 'editMasterPrompt')
actionMap['editMasterPrompt'] = handleEditMasterPrompt

async function handleEditMasterPrompt(message,user,collectionId) {
    console.log('Handling edit master prompt for user:', user, 'collection:', collectionId);
    const collection = await getOrLoadCollection(user,collectionId)
    let text = 'Please enter the new master prompt for your collection:\n utilize the following format: "[[traittype]] image of a [[traittype]] [[traittype]]\n'
    text += `current trait types: ${collection.config.traitTypes.map(trait => trait.title).join(', ')}`
        
    // Set pending action
    studio[user].pendingAction = {
        action: 'editMasterPrompt',
        collectionId: collectionId
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
    });
    setUserState({...message,from: {id: user},chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['editTraitTypes_'] = (action, message, user) => handlePrefix(action, message, user, 'editTraitTypes')
actionMap['editTraitTypes'] = handleEditTraitTypes

async function handleEditTraitTypes(message,user,collectionId) {
    console.log('handle edit trait types',message,user,collectionId)
    const { text, reply_markup } = await buildTraitTypesMenu(user, collectionId);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
    setUserState(message,STATES.IDLE)
}
async function buildTraitTypesMenu(user, collectionId, page = 0) {
    const collection = await getOrLoadCollection(user, collectionId);
    const traitTypes = collection.config.traitTypes || [];
    
    const TRAITS_PER_PAGE = 6;
    const totalPages = Math.ceil(traitTypes.length / TRAITS_PER_PAGE);
    
    const startIdx = page * TRAITS_PER_PAGE;
    const endIdx = Math.min(startIdx + TRAITS_PER_PAGE, traitTypes.length);
    const currentTraits = traitTypes.slice(startIdx, endIdx);

    let text = `Trait Types (${traitTypes.length} total)\nPage ${page + 1} of ${Math.max(1, totalPages)}\n\n`;
    
    // Add trait details
    currentTraits.forEach((trait, idx) => {
        text += `${trait.title}: ${trait.traits?.length || 0} values\n`;
    });

    const inlineKeyboard = [];

    // Add trait type buttons - 2 per row
    for (let i = 0; i < currentTraits.length; i += 2) {
        const row = [];
        row.push({ text: currentTraits[i].title, callback_data: `editTraitType_${collectionId}_${startIdx + i}` });
        
        if (i + 1 < currentTraits.length) {
            row.push({ text: currentTraits[i + 1].title, callback_data: `editTraitType_${collectionId}_${startIdx + i + 1}` });
        }
        inlineKeyboard.push(row);
    }

    // Navigation row
    const navRow = [];
    if (page > 0) {
        navRow.push({ text: '«', callback_data: `traitPage_${collectionId}_${page - 1}` });
    }
    navRow.push({ text: '+ Add Trait', callback_data: `addTrait_${collectionId}` });
    if (page < totalPages - 1) {
        navRow.push({ text: '»', callback_data: `traitPage_${collectionId}_${page + 1}` });
    }
    inlineKeyboard.push(navRow);

    // Back button
    inlineKeyboard.push([{ text: '« Back', callback_data: `collectionConfigMenu_${collectionId}` }]);

    return {
        text,
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };
}

async function handleEditTraitTypes(message, user, collectionId) {
    console.log('handle edit trait types', message, user, collectionId);
    const { text, reply_markup } = await buildTraitTypesMenu(user, collectionId);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

// Handle page navigation
prefixHandlers['traitPage_'] = (action, message, user) => {
    const [_, collectionId, page] = action.split('_');
    handleTraitPage(message, user, parseInt(collectionId), parseInt(page));
}

async function handleTraitPage(message, user, collectionId, page) {
    console.log('Handling trait page navigation for user:', user, 'collection:', collectionId, 'page:', page);
    const { text, reply_markup } = await buildTraitTypesMenu(user, collectionId, page);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

// Add handlers for trait editing and adding new traits
prefixHandlers['addTrait_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleAddTrait(message, user, collectionId);
}

async function handleAddTrait(message, user, collectionId) {
    console.log('Handling add trait type for user:', user, 'collection:', collectionId);
    if (!studio[user]) {
        studio[user] = {};
    }
    
    studio[user].pendingAction = {
        action: 'addTrait',
        collectionId: collectionId
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the name of the new trait type:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
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

prefixHandlers['editTraitValueName_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValueName(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}

async function handleEditTraitValueName(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value name for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);
    if (!studio[user]) {
        studio[user] = {};
    }

    studio[user].pendingAction = {
        action: 'editTraitValueName',
        collectionId: collectionId,
        traitTypeIndex: traitTypeIndex,
        valueIndex: valueIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new name for this trait value:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['editTraitValuePrompt_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValuePrompt(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}

async function handleEditTraitValuePrompt(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value prompt for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);
    if (!studio[user]) {
        studio[user] = {};
    }

    studio[user].pendingAction = {
        action: 'editTraitValuePrompt',
        collectionId: collectionId,
        traitTypeIndex: traitTypeIndex,
        valueIndex: valueIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new prompt for this trait value:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['editTraitValueRarity_'] = (action, message, user) => {
    const [_, collectionId, traitTypeIndex, valueIndex] = action.split('_');
    handleEditTraitValueRarity(message, user, parseInt(collectionId), parseInt(traitTypeIndex), parseInt(valueIndex));
}

async function handleEditTraitValueRarity(message, user, collectionId, traitTypeIndex, valueIndex) {
    console.log('Handling edit trait value rarity for user:', user, 'collection:', collectionId, 
                'traitType:', traitTypeIndex, 'value:', valueIndex);
    if (!studio[user]) {
        studio[user] = {};
    }

    studio[user].pendingAction = {
        action: 'editTraitValueRarity',
        collectionId: collectionId,
        traitTypeIndex: traitTypeIndex,
        valueIndex: valueIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new rarity value (between 0 and 1):',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
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
    if (!studio[user]) {
        studio[user] = {};
    }

    studio[user].pendingAction = {
        action: 'addTraitValue',
        collectionId: collectionId,
        traitTypeIndex: traitTypeIndex
    };

    const instructionText = 'Please enter the trait value(s) in the following format:\n' +
                          'name|prompt|rarity\n\n' +
                          'Examples:\n' +
                          'Red|vibrant red color|0.3\n' +
                          'Blue|deep blue color|0.3\n' +
                          'Green|forest green|0.4\n\n' +
                          'Note:\n' +
                          '- You can add multiple traits by putting each on a new line\n' +
                          '- Prompt and rarity are optional. Default rarity is 0.5';

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: instructionText,
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
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
    await saveStudio(collection);
    
    // Return to trait types menu
    const { text, reply_markup } = await buildTraitTypesMenu(user, collectionId);
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
    const collection = await getOrLoadCollection(user, collectionId);
    

    // First, determine the user's intent with examples
    const intentMessages = [
        {
            role: "system",
            content: `Analyze the user's request and categorize it as one of:
                MASTERPROMPTIMPROVE - When they want to enhance existing style/mood
                MASTERPROMPTEXPAND - When they want to add new elements/concepts
                TRAITTYPESEXPAND - When they want to add new trait categories
                Respond ONLY with one of these categories or NOICANT.
                
                Examples:
                "make it more cyberpunk" -> MASTERPROMPTIMPROVE
                "add some magical elements" -> MASTERPROMPTEXPAND  
                "need traits for accessories" -> TRAITTYPESEXPAND`
        },
        {
            role: "user",
            content: message.text
        }
    ];

    const intentResult = await gptAssist({
        messages: intentMessages,
        formatResult: formatters.raw
    });

    if (!intentResult || intentResult.result === 'NOICANT') {
        await sendMessage(message, "I'm sorry, I couldn't understand how to help improve your collection. Please try being more specific about what you'd like to enhance.");
        return;
    }

    console.log('Determined intent:', intentResult.result);

    // Continue with specific enhancement logic based on intent...
    // TODO: Add specific handling for each intent type
    switch (intentResult.result.trim()) {
        case 'MASTERPROMPTIMPROVE': {
            // Get test prompts ready
            let testPromptBefore = collection.config.masterPrompt;
            let selectedTraits = {};

            // First pass - select traits and store them
            collection.config.traitTypes.forEach(traitType => {
                if (!traitType.traits || !traitType.traits.length) return;
                
                // Calculate total weight for trait selection
                const totalWeight = traitType.traits.reduce((sum, trait) => sum + (trait.rarity || 0.5), 0);
                let random = Math.random() * totalWeight;
                let selectedTrait = traitType.traits[0];
                
                for (const trait of traitType.traits) {
                    random -= (trait.rarity || 0.5);
                    if (random <= 0) {
                        selectedTrait = trait;
                        break;
                    }
                }
                
                console.log(`Selected trait for ${traitType.title}: ${selectedTrait.name} (${selectedTrait.prompt})`);
                selectedTraits[traitType.title] = selectedTrait;
                
                // Replace placeholder in before template
                testPromptBefore = testPromptBefore.replace(`[[${traitType.title}]]`, selectedTrait.prompt);
            });

            const improveMessages = [
                {
                    role: "system", 
                    content: `You are an expert at refining image generation prompts. 
                    Analyze the provided prompt template and example to suggest improvements that enhance style and mood.
                    
                    IMPORTANT FORMATTING RULES:
                    - Return ONLY the improved prompt template
                    - Maintain all [[TRAITTYPE]] placeholders exactly as they appear
                    - Do not include any prefix text like "Refined template:" or similar
                    - Do not include any explanation or additional text
                    - The response should be ready to use as-is for image generation`
                },
                {
                    role: "user",
                    content: `Current master prompt template: ${collection.config.masterPrompt}\n\n` +
                            `Sample constructed prompt: ${testPromptBefore}\n\n` +
                            `User request: ${message.text}`
                }
            ];

            const improveResult = await gptAssist({
                messages: improveMessages,
                formatResult: (response) => {
                    // Clean up any potential prefixes or suffixes
                    let cleaned = response.trim()
                        .replace(/^(improved|prompt|template|:|\s)+/gi, '')
                        .replace(/(\s*template\s*$|\s*prompt\s*$)/gi, '')
                        .trim();
                    
                    return { result: cleaned };
                }
            });

            if (improveResult) {
                // Store proposed changes
                if (!studio[user].proposedChanges) {
                    studio[user].proposedChanges = {};
                }
                studio[user].proposedChanges[collectionId] = {
                    type: 'masterPrompt',
                    before: collection.config.masterPrompt,
                    after: improveResult.result
                };

                // Create after example using same traits
                let testPromptAfter = improveResult.result;
                Object.entries(selectedTraits).forEach(([title, trait]) => {
                    testPromptAfter = testPromptAfter.replace(`[[${title}]]`, trait.prompt);
                });

                const text = "Here's my suggested improvement:\n\n" +
                            "Before Template:\n" + collection.config.masterPrompt + "\n" +
                            "Before Example:\n" + testPromptBefore + "\n\n" +
                            "After Template:\n" + improveResult.result + "\n" +
                            "After Example:\n" + testPromptAfter;

                const reply_markup = {
                    inline_keyboard: [
                        [
                            { text: '✅ Confirm', callback_data: `confirmAIChange_${collectionId}` },
                            { text: '❌ Cancel', callback_data: `cancelAIChange_${collectionId}` }
                        ]
                    ]
                };

                await sendMessage(message, text, { reply_markup });
            }
            break;
        }

        case 'MASTERPROMPTEXPAND': {
            // Similar to MASTERPROMPTIMPROVE but with expand messages
            const expandResult = await gptAssist({
                messages: expandMessages,
                formatResult: formatters.masterPrompt
            });

            if (expandResult) {
                if (!studio[user].proposedChanges) {
                    studio[user].proposedChanges = {};
                }
                studio[user].proposedChanges[collectionId] = {
                    type: 'masterPrompt',
                    before: collection.config.masterPrompt,
                    after: expandResult.result
                };

                const text = "Here's my suggested expansion:\n\n" +
                           "Before:\n" + collection.config.masterPrompt + "\n\n" +
                           "After:\n" + expandResult.result;

                const reply_markup = {
                    inline_keyboard: [
                        [
                            { text: '✅ Confirm', callback_data: `confirmAIChange_${collectionId}` },
                            { text: '❌ Cancel', callback_data: `cancelAIChange_${collectionId}` }
                        ]
                    ]
                };

                await sendMessage(message, text, { reply_markup });
            }
            break;
        }

        case 'TRAITTYPESEXPAND': {
            const traitResult = await gptAssist({
                messages: traitMessages,
                formatResult: formatters.json
            });

            if (traitResult) {
                if (!studio[user].proposedChanges) {
                    studio[user].proposedChanges = {};
                }
                studio[user].proposedChanges[collectionId] = {
                    type: 'traitTypes',
                    before: collection.config.traitTypes,
                    after: [...collection.config.traitTypes, ...traitResult.result.traitTypes]
                };

                let text = "Here are my suggested new trait types:\n\n";
                traitResult.result.traitTypes.forEach(type => {
                    text += `${type.name}:\n`;
                    type.traits.forEach(trait => {
                        text += `- ${trait.name} (${trait.prompt})\n`;
                    });
                    text += '\n';
                });

                const reply_markup = {
                    inline_keyboard: [
                        [
                            { text: '✅ Confirm', callback_data: `confirmAIChange_${collectionId}` },
                            { text: '❌ Cancel', callback_data: `cancelAIChange_${collectionId}` }
                        ]
                    ]
                };

                await sendMessage(message, text, { reply_markup });
            }
            break;
        }
    }
}

// Add these new handlers
prefixHandlers['confirmAIChange_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleConfirmAIChange(message, user, collectionId);
}

prefixHandlers['cancelAIChange_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleCancelAIChange(message, user, collectionId);
}

async function handleConfirmAIChange(message, user, collectionId) {
    const proposedChange = studio[user].proposedChanges?.[collectionId];
    if (!proposedChange) {
        await sendMessage(message, "No pending changes found.");
        return;
    }

    // Apply the changes based on type
    if (proposedChange.type === 'masterPrompt') {
        studio[user][collectionId].config.masterPrompt = proposedChange.after;
    } else if (proposedChange.type === 'traitTypes') {
        studio[user][collectionId].config.traitTypes = proposedChange.after;
    }

    // Save the changes
    await saveStudio(studio[user][collectionId]);
    
    // Clean up
    delete studio[user].proposedChanges[collectionId];
    
    await sendMessage(message, "Changes have been saved!");
    await handleCollectionMenu(message, user, collectionId);
}

async function handleCancelAIChange(message, user, collectionId) {
    if (studio[user].proposedChanges?.[collectionId]) {
        delete studio[user].proposedChanges[collectionId];
    }
    
    await sendMessage(message, "Changes have been discarded.");
    await handleCollectionMenu(message, user, collectionId);
}



