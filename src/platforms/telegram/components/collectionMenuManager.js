/**
 * @file collectionMenuManager.js
 * @description Handles collection-related commands and callbacks.
 */

const { CollectionsWorkflow } = require('../../../workflows/collections');
const { escapeMarkdownV2 } = require('../../../utils/stringUtils');

/**
 * All-in-one manager for collections feature.
 * @param {object} dispatchers - The dispatchers object.
 * @param {object} dependencies - The dependencies needed by the handlers.
 */
function registerHandlers(dispatchers, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher } = dispatchers;
    const { logger, bot, sessionService, mediaService, db, internalApiClient } = dependencies;

    const collectionsWorkflow = new CollectionsWorkflow({
        sessionService,
        mediaService,
        db,
        logger
    });

    async function getMasterAccountId(platformId, from) {
        const findOrCreateResponse = await internalApiClient.post('/users/find-or-create', {
            platform: 'telegram',
            platformId: platformId.toString(),
            platformContext: { firstName: from.first_name, username: from.username }
        });
        return findOrCreateResponse.data.masterAccountId;
    }

    async function listCollections(message, userId) {
        try {
            const collections = await collectionsWorkflow.getUserCollections(userId);
            if (!collections || collections.length === 0) {
                await bot.sendMessage(message.chat.id, "You don't have any collections yet. Use `/collections create [name]` to create one.", { reply_to_message_id: message.message_id, parse_mode: 'MarkdownV2' });
                return;
            }
            let text = '📚 *Your Collections:*\n\n';
            const inlineKeyboard = collections.map(collection => {
                text += `• ${escapeMarkdownV2(collection.name)} (${collection.status})\n`;
                return [
                    { text: `View ${collection.name}`, callback_data: `collection:view:${collection.collectionId}` },
                    { text: '✏️ Edit', callback_data: `collection:edit:${collection.collectionId}` },
                    { text: '🗑️ Delete', callback_data: `collection:delete:${collection.collectionId}` }
                ];
            });
            await bot.sendMessage(message.chat.id, text, { reply_to_message_id: message.message_id, reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'MarkdownV2' });
        } catch (error) {
            logger.error('Error listing collections:', error);
            await bot.sendMessage(message.chat.id, 'Sorry, an error occurred while retrieving your collections.', { reply_to_message_id: message.message_id });
        }
    }

    async function createCollection(message, userId, name) {
        if (!name || name.trim() === '') {
            await bot.sendMessage(message.chat.id, 'Please provide a name for your collection. Example: `/collections create My Awesome Collection`', { reply_to_message_id: message.message_id, parse_mode: 'MarkdownV2' });
            return;
        }
        try {
            const statusMessage = await bot.sendMessage(message.chat.id, 'Creating your collection...', { reply_to_message_id: message.message_id });
            const newCollection = await collectionsWorkflow.createCollection(userId, name);
            await bot.editMessageText(`Collection "${escapeMarkdownV2(name)}" created successfully! You can now add items to it.`, {
                chat_id: statusMessage.chat.id,
                message_id: statusMessage.message_id,
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'View Collection', callback_data: `collection:view:${newCollection.collectionId}` }, { text: 'Edit Settings', callback_data: `collection:edit:${newCollection.collectionId}` }]
                    ]
                }
            });
        } catch (error) {
            logger.error('Error creating collection:', error);
            await bot.sendMessage(message.chat.id, 'Sorry, an error occurred while creating your collection.', { reply_to_message_id: message.message_id });
        }
    }
    
    async function viewCollection(message, userId, collectionId) {
        try {
            const collection = await collectionsWorkflow.getCollection(userId, collectionId);
            let text = `📚 *Collection: ${escapeMarkdownV2(collection.name)}*\n`;
            text += `Status: ${escapeMarkdownV2(collection.status)}\n`;
            text += `Size: ${collection.size || 0} items\n\n`;
            if (collection.config?.masterPrompt) {
                text += `*Master Prompt:* ${escapeMarkdownV2(collection.config.masterPrompt)}\n\n`;
            }
            const buttons = [
                [{ text: 'Edit Collection', callback_data: `collection:edit:${collectionId}` }, { text: 'Delete Collection', callback_data: `collection:delete:${collectionId}` }]
            ];
            await bot.sendMessage(message.chat.id, text, { reply_to_message_id: message.message_id, reply_markup: { inline_keyboard: buttons }, parse_mode: 'MarkdownV2' });
        } catch (error) {
             logger.error(`Error viewing collection ${collectionId}:`, error);
             await bot.sendMessage(message.chat.id, 'Sorry, an error occurred while retrieving your collection.', { reply_to_message_id: message.message_id });
        }
    }
    
    async function deleteCollection(message, userId, collectionId) {
         try {
            await collectionsWorkflow.deleteCollection(userId, collectionId);
            await bot.sendMessage(message.chat.id, 'Collection has been deleted.', { reply_to_message_id: message.message_id });
        } catch (error) {
            logger.error(`Error deleting collection ${collectionId}:`, error);
            await bot.sendMessage(message.chat.id, 'Sorry, an error occurred while deleting the collection.', { reply_to_message_id: message.message_id });
        }
    }

    commandDispatcher.register(/^\/collections(?:@\w+)?\s*(.*)/i, async (message, match) => {
        const userId = message.from.id.toString();
        const masterAccountId = await getMasterAccountId(userId, message.from);
        const args = (match[1] || '').trim().split(/\s+/);
        const command = args[0] ? args[0].toLowerCase() : 'list';
        const name = args.slice(1).join(' ');

        switch (command) {
            case 'list':
                await listCollections(message, masterAccountId);
                break;
            case 'create':
                await createCollection(message, masterAccountId, name);
                break;
            default:
                await bot.sendMessage(message.chat.id, "Unknown collections command. Try `list` or `create`.", { reply_to_message_id: message.message_id });
        }
    });

    callbackQueryDispatcher.register('collection:', async (bot, callbackQuery, masterAccountId, deps) => {
        const { data, message } = callbackQuery;
        const parts = data.split(':');
        const action = parts[1];
        const collectionId = parts[2];
        
        const effectiveMessage = { ...message, from: callbackQuery.from, message_id: message.message_id };

        switch (action) {
            case 'view':
                await viewCollection(effectiveMessage, masterAccountId, collectionId);
                await bot.answerCallbackQuery(callbackQuery.id);
                break;
            case 'edit':
                await bot.sendMessage(message.chat.id, 'To edit, use commands like `/collections rename` etc. (Not implemented)', { reply_to_message_id: message.message_id, parse_mode: 'MarkdownV2' });
                await bot.answerCallbackQuery(callbackQuery.id);
                break;
            case 'delete':
                await bot.sendMessage(message.chat.id, `Are you sure you want to delete this collection? This cannot be undone.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Yes, delete it', callback_data: `collection:confirm_delete:${collectionId}` }, { text: 'No, keep it', callback_data: 'collection:cancel_delete' }]
                        ]
                    }
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                break;
            case 'confirm_delete':
                await deleteCollection(effectiveMessage, masterAccountId, collectionId);
                 await bot.editMessageText('Collection deletion confirmed.', { chat_id: message.chat.id, message_id: message.message_id, reply_markup: null });
                await bot.answerCallbackQuery(callbackQuery.id);
                break;
            case 'cancel_delete':
                await bot.editMessageText('Collection deletion cancelled.', { chat_id: message.chat.id, message_id: message.message_id, reply_markup: null });
                await bot.answerCallbackQuery(callbackQuery.id);
                break;
            default:
                logger.warn(`[CollectionManager] Unknown collection action: ${action}`);
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Unknown collection action" });
        }
    });
}

module.exports = {
    registerHandlers,
}; 