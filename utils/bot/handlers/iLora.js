const { sendMessage, editMessage } = require('../../utils');
const { loraTriggers, commandRegistry, prefixHandlers, actionMap } = require('../bot');


commandRegistry['/loras'] = {
    handler: displayLoraMenu,
};

// Helper function to escape special characters for MarkdownV2
const escapeMarkdown = (text) => {
    return text.replace(/[-[\](){}+?.*\\^$|#,.!]/g, '\\$&');
};

async function displayLoraMenu(message, user = null,category = 'main') {
    const chatId = message.chat.id;
    
    // Ensure we have a non-empty message text
    const menuMessage = '*LoRA Categories* 🎨\nSelect a category to explore:';
    
    const inlineKeyboard = [
        [
            { text: '😹 Memes', callback_data: 'lora_memes' },
        ],
        [
            { text: '🎭 Character', callback_data: 'lora_characters' },
            { text: '🖼 Style', callback_data: 'lora_styles' }
        ],
        [
            { text: '🔥 Popular', callback_data: 'lora_popular' },
            { text: '⏳ Recent', callback_data: 'lora_recent' }
        ],
        [
            { text: '🔍 Search', callback_data: 'lora_search' }
        ]
    ];

    const options = {
        reply_markup: { inline_keyboard: inlineKeyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        console.log('Sending/Editing menu message:', {
            chatId,
            menuMessage,
            isEdit: !!user
        });
        
        if(user) {
            await editMessage({
                text: menuMessage,
                chat_id: chatId,
                message_id: message.message_id,
                reply_markup: options.reply_markup,
                parse_mode: options.parse_mode
            });
        } else {
            await sendMessage(message, menuMessage, options);
        }
    } catch (error) {
        console.error('Error in displayLoraMenu:', error);
        // Fallback attempt with simpler message
        try {
            await sendMessage(message, 'LoRA Categories Menu');
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
    }
}

async function displayLoraCategory(message, category, user = null, page = 1 ) {
    const ITEMS_PER_PAGE = 10;
    const chatId = message.chat.id;
    
    // Filter and sort LoRAs based on category
    let filteredLoras;
    let messageTitle;
    
    switch (category) {
        case 'popular':
            messageTitle = '🔥 Popular LoRAs';
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden)
                .sort((a, b) => (b.uses || 0) - (a.uses || 0))
                .slice(0, ITEMS_PER_PAGE);
            break;
            
        case 'recent':
            messageTitle = '⏳ Recent LoRAs';
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden)
                .sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0))
                .slice(0, ITEMS_PER_PAGE);
            break;
            
        case 'memes':
            messageTitle = '😹 Meme LoRAs';
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden && lora.type === 'meme');
            break;
            
        case 'characters':
            messageTitle = '🎭 Character LoRAs';
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden && lora.type === 'character');
            break;
            
        case 'styles':
            messageTitle = '🖼 Style LoRAs';
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden && lora.type === 'style');
            break;
            
        default:
            messageTitle = `${category.charAt(0).toUpperCase() + category.slice(1)} LoRAs`;
            filteredLoras = loraTriggers
                .filter(lora => !lora.hidden && lora.type === category);
    }

    // Paginate results
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const paginatedLoras = filteredLoras.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    
    let messageText = `${messageTitle}\n\n`;
    messageText += 'Click to copy trigger words:\n';

    // Build LoRA list
    paginatedLoras.forEach(lora => {
        let currentString = '\n`';
        lora.triggerWords.forEach(word => {
            if (word !== '#') {
                currentString += `${word}, `;
            } else {
                currentString += `\` \``;
            }
        });
        if (currentString.endsWith(', ')) {
            currentString = currentString.slice(0, -2);
        }
        currentString += '`';
        if (lora.version) {
            currentString += ` \\(${escapeMarkdown(lora.version)}\\)`;
        }
        messageText += currentString;
    });

    // Build navigation keyboard
    const totalPages = Math.ceil(filteredLoras.length / ITEMS_PER_PAGE);
    const keyboard = [];

    // Add pagination buttons if needed
    if (totalPages > 1) {
        keyboard.push([
            page > 1 ? { text: '◀️', callback_data: `lora_${category}_${page-1}` } : { text: ' ', callback_data: 'noop' },
            { text: `${page}/${totalPages}`, callback_data: 'noop' },
            page < totalPages ? { text: '▶️', callback_data: `lora_${category}_${page+1}` } : { text: ' ', callback_data: 'noop' }
        ]);
    }

    // Add navigation buttons
    keyboard.push([
        { text: '🔙 Menu', callback_data: 'lora_main' },
        { text: '🔍 Search', callback_data: 'lora_search' }
    ]);

    const options = {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        console.log('Displaying LoRA category:', {
            category,
            page,
            totalPages: totalPages,
            lorasOnPage: paginatedLoras.length,
            isEdit: !!user
        });

        if(user) {
            await editMessage({
                text: messageText,
                chat_id: chatId,
                message_id: message.message_id,
                reply_markup: options.reply_markup,
                parse_mode: options.parse_mode
            });
        } else {
            await sendMessage(message, messageText, options);
        }
    } catch (error) {
        console.error('Error sending LoRA category list:', error);
    }
}

// Add to your existing prefixHandlers
prefixHandlers['lora_'] = (action, message, user) => {
    const category = action.replace('lora_', '');
    if (category === 'main') {
        displayLoraMenu(message, user);
    } else {
        handleLoraCallback(message, category, user);
    }
};

// Handle callback queries for LoRA menu navigation
async function handleLoraCallback(message, category, user = null) {
    console.log('Handling LoRA callback:', { category, messageId: message.message_id });

    switch (category) {
        case 'main':
            await displayLoraMenu(message, user);
            break;
            
        case 'search':
            await handleLoraSearch(message, user);
            break;
            
        default:
            await displayLoraCategory(message, category, user);
            break;
    }
}

// TODO: Implement search functionality
async function handleLoraSearch(message) {
    // This will be implemented in the next iteration
}

module.exports = {
    displayLoraMenu,
    displayLoraCategory,
    handleLoraCallback,
    handleLoraSearch
};
