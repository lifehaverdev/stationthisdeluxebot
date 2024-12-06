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
        const { name, status, submitted } = collectionData;

        let menuText = `${name}\nSTATUS: ${status}`;
        if (submitted) {
            const timeSinceSubmitted = Math.floor((Date.now() - submitted) / 1000);
            menuText += `\nSubmitted: ${timeSinceSubmitted} seconds ago`;
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
    console.log('remove collection',user,collectionId)
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
    console.log('handle collection meta data',message,user,collectionId)
    const { text, reply_markup } = await buildCollectionMetaDataMenu(user,collectionId)
    updateMessage(message.chat.id,message.message_id, { reply_markup }, text)
}

async function buildCollectionMetaDataMenu(user, collectionId) {
    const collection = await getOrLoadCollection(user, collectionId);
    
    const text = `Collection Metadata for ${collection.name}\n\n` +
                 `Supply: ${collection.totalSupply || 'Not set'}\n` +
                 `Chain: ${collection.chain || 'Not set'}\n` + 
                 `Royalties: ${collection.royalties || '0'}%`;

    return {
        text,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Set Supply', callback_data: `supply_${collectionId}` },
                    { text: '⛓️ Set Chain', callback_data: `chain_${collectionId}` }
                ],
                [
                    { text: '💰 Set Royalties', callback_data: `royalty_${collectionId}` }
                ],
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
        console.log('No pending action found for user');
        return;
    }

    const { action, collectionId } = studio[userId].pendingAction;
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
        case 'editMasterPrompt':
            console.log('edit master prompt',message,userId,collectionId)
            const masterPrompt = message.text
            studio[userId][collectionId].config.masterPrompt = masterPrompt
            backTo = 'config'
            break;
        case 'addTrait':
            const trait = message.text
            studio[userId][collectionId].config.traitTypes.push(trait)
            backTo = 'config'
            break;
        case 'editTraitName':
            const newTraitName = message.text
            studio[userId][collectionId].config.traitTypes[traitIndex] = newTraitName
            backTo = 'config'
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
    }
}


prefixHandlers['collectionConfigMenu_'] = (action, message, user) => handlePrefix(action, message, user, 'collectionConfigMenu')
actionMap['collectionConfigMenu'] = handleCollectionConfigMenu
async function handleCollectionConfigMenu(message,user,collectionId) {
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
    const text = `Collection Config for ${collection.name}\n\n` +
                 `Master Prompt: ${masterPrompt}\n` +
                 `Trait Types: ${traitTypes.join(', ')}`
    return {
        text,
        reply_markup: {
            inline_keyboard: [
                [{ text: '« Back', callback_data: `ec_${collectionId}` }],
                [{ text: 'Edit Master Prompt', callback_data: `editMasterPrompt_${collectionId}` }],
                [{ text: 'Edit Trait Tree', callback_data: `editTraitTypes_${collectionId}` }]
            ]
        }
    }
}

prefixHandlers['editMasterPrompt_'] = (action, message, user) => handlePrefix(action, message, user, 'editMasterPrompt')
actionMap['editMasterPrompt'] = handleEditMasterPrompt

async function handleEditMasterPrompt(message,user,collectionId) {
    console.log('handle edit master prompt',message,user,collectionId)
    const collection = await getOrLoadCollection(user,collectionId)
    let text = 'Please enter the new master prompt for your collection:\n utilize the following format: "[[traittype]] image of a [[traittype]] [[traittype]]\n'
    text += `current trait types: ${collection.config.traitTypes.join(', ')}`
        
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
    const { traitTypes } = collection.config;
    
    const TRAITS_PER_PAGE = 6;
    const totalPages = Math.ceil(traitTypes.length / TRAITS_PER_PAGE);
    
    const startIdx = page * TRAITS_PER_PAGE;
    const endIdx = Math.min(startIdx + TRAITS_PER_PAGE, traitTypes.length);
    const currentTraits = traitTypes.slice(startIdx, endIdx);

    const text = `Trait Types (${traitTypes.length} total)\nPage ${page + 1} of ${Math.max(1, totalPages)}`;

    const inlineKeyboard = [];

    // Add trait type buttons - 2 per row
    for (let i = 0; i < currentTraits.length; i += 2) {
        const row = [];
        row.push({ text: currentTraits[i], callback_data: `editTrait_${collectionId}_${startIdx + i}` });
        
        if (i + 1 < currentTraits.length) {
            row.push({ text: currentTraits[i + 1], callback_data: `editTrait_${collectionId}_${startIdx + i + 1}` });
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
        navRow.push({ text: '»', callback_data: `traitPage_${collectionId}_${page}` });
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
    const { text, reply_markup } = await buildTraitTypesMenu(user, collectionId, page);
    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

// Add handlers for trait editing and adding new traits
prefixHandlers['addTrait_'] = (action, message, user) => {
    const collectionId = parseInt(action.split('_')[1]);
    handleAddTrait(message, user, collectionId);
}

async function handleAddTrait(message, user, collectionId) {
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

prefixHandlers['editTrait_'] = (action, message, user) => {
    const [_, collectionId, traitIndex] = action.split('_');
    handleEditTraitMenu(message, user, parseInt(collectionId), parseInt(traitIndex));
}

async function handleEditTraitMenu(message, user, collectionId, traitIndex) {
    const collection = await getOrLoadCollection(user, collectionId);
    const traitName = collection.config.traitTypes[traitIndex];
    
    const text = `Edit trait: ${traitName}`;
    
    const reply_markup = {
        inline_keyboard: [
            [
                { text: '✏️ Edit Name', callback_data: `editTraitName_${collectionId}_${traitIndex}` },
                { text: '➕ Add Value', callback_data: `addTraitValue_${collectionId}_${traitIndex}` }
            ],
            [{ text: '« Back', callback_data: `editTraitTypes_${collectionId}` }]
        ]
    };

    updateMessage(message.chat.id, message.message_id, { reply_markup }, text);
}

prefixHandlers['editTraitName_'] = (action, message, user) => {
    const [_, collectionId, traitIndex] = action.split('_');
    handleEditTraitName(message, user, parseInt(collectionId), parseInt(traitIndex));
}

async function handleEditTraitName(message, user, collectionId, traitIndex) {
    if (!studio[user]) {
        studio[user] = {};
    }
    
    studio[user].pendingAction = {
        action: 'editTraitName',
        collectionId: collectionId,
        traitIndex: traitIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new name for this trait type:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}

prefixHandlers['addTraitValue_'] = (action, message, user) => {
    const [_, collectionId, traitIndex] = action.split('_');
    handleAddTraitValue(message, user, parseInt(collectionId), parseInt(traitIndex));
}

async function handleAddTraitValue(message, user, collectionId, traitIndex) {
    console.log('handle add trait value', message, user, collectionId, traitIndex);
    // TODO: Implement this
    if (!studio[user]) {
        studio[user] = {};
    }

    // Set pending action for adding trait value
    studio[user].pendingAction = {
        action: 'addTraitValue',
        collectionId: collectionId,
        traitIndex: traitIndex
    };

    await editMessage({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: 'Please enter the new trait value:',
    });

    setUserState({...message, from: {id: user}, chat: {id: message.chat.id}}, STATES.SETCOLLECTION);
}