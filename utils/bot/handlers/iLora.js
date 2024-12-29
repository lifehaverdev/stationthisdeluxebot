const { sendMessage, editMessage } = require('../../utils');
const { loraTriggers, lobby, commandRegistry, prefixHandlers, actionMap } = require('../bot');
const { Loras } = require('../../../db/models/loras.js');
const loras = new Loras();
const fs = require('fs').promises;
const path = require('path');


commandRegistry['/loras'] = {
    handler: displayLoraMenu,
};

commandRegistry['/loralist'] = {
    handler: async (message) => {
        await sendMessage(message, 'use /loras from now on pls')
        await displayLoraMenu(message)
    }, // iWork.sendLoRaModelFilenames
};

// Helper function to escape special characters for MarkdownV2
const escapeMarkdown = (text) => {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};

async function displayLoraMenu(message, user = null,category = 'main') {
    const chatId = message.chat.id;
    
    // Ensure we have a non-empty message text
    const menuMessage = '*LoRA Categories* 🎨\nSelect a category to explore:';
    
    const inlineKeyboard = [
        [
            { text: '😹 Memes', callback_data: 'lora_meme' },
        ],
        [
            { text: '🎭 Character', callback_data: 'lora_character' },
            { text: '🖼 Style', callback_data: 'lora_style' }
        ],
        [
            { text: '🔥 Popular', callback_data: 'lora_popular' },
            { text: '⏳ Recent', callback_data: 'lora_recent' }
        ],
        [
            //{ text: '🔍 Search', callback_data: 'lora_search' },
        ],
        [
            { text: '💖 Favorites', callback_data: 'lora_favorites' }
        ],
        [
            { text: 'nvm', callback_data: 'cancel' }
        ]
    ];

    const options = {
        reply_markup: { inline_keyboard: inlineKeyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        
        if(user) {
            await editMessage({
                text: menuMessage,
                chat_id: chatId,
                message_id: message.message_id,
                options
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

        case 'favorites':
            await displayFavorites(message, user);
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
       

        if(user) {
            await editMessage({
                text: messageText,
                chat_id: chatId,
                message_id: message.message_id,
                options
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

prefixHandlers['lorasub_'] = (action, message, user) => {
    // Extract primary and secondary tags from the callback data
    const [primaryTag, ...secondaryTagParts] = action.replace('lorasub_', '').split('_');
    // Rejoin secondary tag parts that were split by spaces
    const secondaryTag = secondaryTagParts.join('_');
    
    
    displayLorasByTag(message, primaryTag, secondaryTag, user);
};

// Handle callback queries for LoRA menu navigation
async function handleLoraCallback(message, category, user = null) {

    if (category.startsWith('lorasub_')) {
        // Extract primary and secondary tags from the callback data
        const [_, primaryTag, ...secondaryTagParts] = category.split('_');
        // Rejoin secondary tag parts that were split by spaces
        const secondaryTag = secondaryTagParts.join('_');
        await displayLorasByTag(message, primaryTag, secondaryTag, user);
        return;
    }

    switch (category) {
        case 'main':
            await displayLoraMenu(message, user);
            break;
            
        case 'search':
            await handleLoraSearch(message, user);
            break;
            
        case 'recent':
            await displayRecentLoras(message, user);
            break;

        case 'favorites':
            await displayFavorites(message, user);
            break;

        case 'popular':
            await displayPopularLoras(message, user);
            break;

        case 'meme':
        case 'character':
        case 'style':
            await displaySubcategories(message, category, user);
            break;
            
        default:
            console.error('Unknown category:', category);
            break;
    }
}

// TODO: Implement search functionality
async function handleLoraSearch(message) {
    // This will be implemented in the next iteration
}

// Helper function to get tag counts
function getTagCounts(loras, primaryTag) {
    const tagCounts = {};
    loras.forEach(lora => {
        Object.keys(lora.tags).forEach(tag => {
            if (tag !== primaryTag && lora.tags[tag] === true) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        });
    });
    return tagCounts;
}

// Helper function to get all secondary tags for a category
async function getSecondaryTags(primaryTag) {
    
    const relevantLoras = await loras.findMany({
        [`tags.${primaryTag}`]: true,
        disabled: false
    });

    // Get counts for each tag
    const tagCounts = getTagCounts(relevantLoras, primaryTag);

    // Only keep tags that appear 4 or more times
    const significantTags = Object.entries(tagCounts)
        .filter(([_, count]) => count >= 4)
        .map(([tag, _]) => tag);

    return { significantTags, relevantLoras };
}

// Helper function to get the display name for a lora with appropriate emoji
function getLoraDisplayName(lora) {
    const displayName = lora.cognates?.find(c => c.replaceWith)?.word || lora.triggerWords[0];
    
    // Add emojis based on recency and popularity
    const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const isRecent = lora.addedDate && lora.addedDate > fiveDaysAgo;
    const isPopular = lora.uses > 100;
    
    const emoji = isRecent ? '✨' : (isPopular ? '🔥' : '');
    return `${displayName}${emoji ? ` ${emoji}` : ''}`;
}

// Get loras that should be displayed directly (not in folders)
async function getUntaggedLoras(primaryTag, relevantLoras, significantTags) {
    
    const untagged = relevantLoras.filter(lora => {
        const otherTags = Object.entries(lora.tags)
            .filter(([tag, value]) => tag !== primaryTag && value === true)
            .map(([tag, _]) => tag);
            
        const hasSignificantTag = otherTags.some(tag => significantTags.includes(tag));
        return !hasSignificantTag;
    });

    // Sort by recency first, then by uses
    const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const sortedUntagged = untagged.sort((a, b) => {
        const aIsRecent = a.addedDate && a.addedDate > fiveDaysAgo;
        const bIsRecent = b.addedDate && b.addedDate > fiveDaysAgo;
        
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;
        
        // If both are recent or both are not recent, sort by uses
        return (b.uses || 0) - (a.uses || 0);
    });

    return sortedUntagged;
}

async function displaySubcategories(message, primaryTag, user = null) {
    const { significantTags, relevantLoras } = await getSecondaryTags(primaryTag);
    const untaggedLoras = await getUntaggedLoras(primaryTag, relevantLoras, significantTags);
    
    let messageText = `*${primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1)} LoRAs*\n\n`;
    
    const keyboard = [
        // Create folder buttons only for significant tags
        ...significantTags.map(tag => [{
            text: `📁 ${tag} (${getTagCounts(relevantLoras, primaryTag)[tag]})`,
            callback_data: `lorasub_${primaryTag}_${tag}`
        }]),
        
        // Create buttons for untagged/insignificant-tagged loras
        ...untaggedLoras.map(lora => [{
            text: getLoraDisplayName(lora),
            callback_data: `loradetail_${lora.lora_name}`
        }]),
        
        // Back button
        [{ text: '🔙 Back', callback_data: 'lora_main' }]
    ];

    const options = {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        if(user) {
            await editMessage({
                text: messageText,
                chat_id: message.chat.id,
                message_id: message.message_id,
                options
            });
        } else {
            await sendMessage(message, messageText, options);
        }
    } catch (error) {
        console.error('Error in displaySubcategories:', error);
    }
}

// Display loras for a specific secondary tag
async function displayLorasByTag(message, primaryTag, secondaryTag, user = null) {
    
    // Convert underscores back to spaces for the database query
    const queryTag = secondaryTag.replace(/_/g, ' ');
    
    // Find loras that have both tags
    const taggedLoras = await loras.findMany({
        [`tags.${primaryTag}`]: true,
        [`tags.${queryTag}`]: true,
        disabled: false
    });
    
    // Sort by recency and popularity
    const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const sortedLoras = taggedLoras.sort((a, b) => {
        const aIsRecent = a.addedDate && a.addedDate > fiveDaysAgo;
        const bIsRecent = b.addedDate && b.addedDate > fiveDaysAgo;
        
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;
        
        return (b.uses || 0) - (a.uses || 0);
    });
    
    let messageText = `*${primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1)} › ${queryTag}*\n\n`;
    
    const keyboard = [
        // Create buttons for each lora
        ...sortedLoras.map(lora => [{
            text: getLoraDisplayName(lora),
            callback_data: `loradetail_${lora.lora_name}`
        }]),
        
        // Navigation buttons
        [
            { text: '🔙 Category', callback_data: `lora_${primaryTag}` },
            { text: '🏠 Menu', callback_data: 'lora_main' }
        ]
    ];

    const options = {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        
        if(user) {
            await editMessage({
                text: messageText,
                chat_id: message.chat.id,
                message_id: message.message_id,
                options
            });
        } else {
            await sendMessage(message, messageText, options);
        }
    } catch (error) {
        console.error('Error in displayLorasByTag:', error);
    }
}

async function displayRecentLoras(message, user = null) {
    // Get all active loras
    const allLoras = await loras.findMany({ disabled: false });
    
    // Calculate the cutoff date for the last 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = Date.now() - (5 * 24 * 60 * 60 * 1000);
    
    // Filter and sort loras by date
    const recentLoras = allLoras
        .filter(lora => lora.addedDate && lora.addedDate > thirtyDaysAgo)
        .sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0));

    let messageText = '*Recently Added LoRAs* ✨\n\n';
    messageText += 'Last 30 days:\n';
    
    const keyboard = [
        // Create buttons for recent loras
        ...recentLoras.map(lora => {
            const isVeryRecent = lora.addedDate > fiveDaysAgo;
            return [{
                text: `${getLoraDisplayName(lora)}${isVeryRecent ? ' ✨' : ''}`,
                callback_data: `loradetail_${lora.lora_name}`
            }];
        }),
        
        // Navigation buttons
        [
            { text: '🔙 Menu', callback_data: 'lora_main' },
            { text: '🔍 Search', callback_data: 'lora_search' }
        ]
    ];

    const options = {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        
        if(user) {
            await editMessage({
                text: messageText,
                chat_id: message.chat.id,
                message_id: message.message_id,
                options
            });
        } else {
            await sendMessage(message, messageText, options);
        }
    } catch (error) {
        console.error('Error in displayRecentLoras:', error);
    }
}


async function displayFavorites(message, user) {
    if (!user || !lobby[user]?.favorites?.loras?.length) {
        const noFavMessage = '*No Favorites Yet* 💝\nAdd some LoRAs to your favorites to see them here\\!';
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: noFavMessage,
            options: {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'lora_main' }
                    ]]
                }
            }
            
        });
        return;
    }

    // Get all favorited loras
    const favoriteLoras = await Promise.all(
        lobby[user].favorites.loras.map(loraName => 
            loras.findOne({ lora_name: loraName })
        )
    );

    // Filter out any null results (in case a lora was deleted)
    const validLoras = favoriteLoras.filter(lora => lora !== null);

    // Sort by uses
    const sortedLoras = validLoras.sort((a, b) => (b.uses || 0) - (a.uses || 0));

    let messageText = '*Your Favorite LoRAs* ❤️\n\n';
    
    const keyboard = [
        // Create buttons for each favorite lora
        ...sortedLoras.map(lora => [{
            text: getLoraDisplayName(lora),
            callback_data: `loradetail_${lora.lora_name}`
        }]),
        // Back button
        [{ text: '🔙 Menu', callback_data: 'lora_main' }]
    ];

    const options = {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboard } 
    };

    try {
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: messageText,
            options
        });
    } catch (error) {
        console.error('Error in displayFavorites:', error);
    }
}


async function displayPopularLoras(message, user = null) {
    // Get all active loras and sort by uses
    const popularLoras = await loras.findMany({ disabled: false });
    const sortedLoras = popularLoras
        .sort((a, b) => (b.uses || 0) - (a.uses || 0))
        .slice(0, 10); // Get top 10

    let messageText = '*Most Popular LoRAs* 🔥\n\n';
    
    const keyboard = [
        // Create buttons for popular loras
        ...sortedLoras.map(lora => [{
            text: `${getLoraDisplayName(lora)} (${lora.uses || 0} uses)`,
            callback_data: `loradetail_${lora.lora_name}`
        }]),
        
        // Back button
        [{ text: '🔙 Menu', callback_data: 'lora_main' }]
    ];

    const options = {
        
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboard }
    };

    if (user) {
        options.message_id = message.message_id;
        await editMessage({
            chat_id: message.chat.id,
            text: messageText,
            options
        });
    } else {
        await sendMessage(message, messageText, {
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
}


prefixHandlers['loradetail_'] = async (action, message, user) => {
    const loraName = action.replace('loradetail_', '');
    await displayLoraDetail(message, loraName, user);
};

// Helper function to check if a lora is favorited by a user
function isLoraFavorited(user, loraName) {
    return user && 
           lobby[user] && 
           lobby[user].favorites && 
           lobby[user].favorites.loras && 
           lobby[user].favorites.loras.includes(loraName);
}

async function displayLoraDetail(message, loraName, user = null) {
    
    
    const lora = await loras.findOne({ lora_name: loraName });
    if (!lora) {
        console.error(`LoRA not found: ${loraName}`);
        return;
    }

    // Check for example image
    const imagePath = path.join(process.cwd(), 'loraExamples', `${loraName}.png`);
    let hasImage = false;
    try {
        await fs.access(imagePath);
        hasImage = true;
    } catch (error) {
        console.log(`No example image found for ${loraName}`);
    }

    // Build message text with better formatting
    let messageText = `*${escapeMarkdown(getLoraDisplayName(lora))}*\n`;
    messageText += `\`${lora.lora_name}\`\n\n`;
    
    // Add description if available
    if (lora.description) {
        messageText += `_${escapeMarkdown(lora.description)}_\n\n`;
    }

    // Stats section
    messageText += '*Stats* 📊\n';
    messageText += `Type: ${escapeMarkdown(lora.type)}\n`;
    messageText += `Version: ${escapeMarkdown(lora.version)}\n`;
    messageText += `Uses: ${lora.uses || 0}\n`;
    messageText += `Rating: ${lora.rating ? '⭐'.repeat(Math.round(lora.rating)) : 'Not rated'}\n\n`;

    // Trigger words section with copy hint
    messageText += '*Trigger Words* 📝\n';
    messageText += '`' + escapeMarkdown(lora.triggerWords.join(', ')) + '`\n\n';

    // Image status
    if (!hasImage) {
        messageText += '_No example image available_\n';
    }

    // Add civitai link if available
    if (lora.civitaiLink) {
        messageText += `\n[View on Civitai](${lora.civitaiLink.replace(/[)\\]/g, '\\$&')})\n`;
    }

    const isFavorited = isLoraFavorited(user, loraName);
    const keyboard = [
        // Rating buttons
        [
            { text: '⭐', callback_data: `lorarate_${loraName}_1` },
            { text: '⭐⭐', callback_data: `lorarate_${loraName}_2` },
            { text: '⭐⭐⭐', callback_data: `lorarate_${loraName}_3` },
        ],
        // Action buttons
        [
            { 
                text: isFavorited ? '💔 Un-favorite' : '❤️ Favorite',
                callback_data: `lorafav_${loraName}` 
            },
            { text: '🔙 Back', callback_data: 'lora_main' }
        ]
    ];

    const options = {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'MarkdownV2'
    };

    try {
        if (user) {
            await editMessage({
                text: messageText,
                chat_id: message.chat.id,
                message_id: message.message_id,
                options
            });
        } else {
            await sendMessage(message, messageText, options);
        }

        // If there's an image, send it as a follow-up message
        if (hasImage) {
            await sendMessage(message, {
                photo: imagePath,
                caption: `Example for ${getLoraDisplayName(lora)}`
            });
        }
    } catch (error) {
        console.error('Error in displayLoraDetail:', error);
        console.error('Message text was:', messageText);
    }
}

// Add the favorite handler
prefixHandlers['lorafav_'] = async (action, message, user) => {
    if (!user || !lobby[user]) {
        console.error('No user found for favorite action');
        return;
    }

    const loraName = action.replace('lorafav_', '');
    
    // Initialize favorites structure if it doesn't exist
    if (!lobby[user].favorites) {
        lobby[user].favorites = { loras: [] };
    }
    if (!lobby[user].favorites.loras) {
        lobby[user].favorites.loras = [];
    }

    // Toggle favorite status
    const index = lobby[user].favorites.loras.indexOf(loraName);
    if (index === -1) {
        // Add to favorites
        lobby[user].favorites.loras.push(loraName);
        console.log(`Added ${loraName} to favorites for user ${user}`);
    } else {
        // Remove from favorites
        lobby[user].favorites.loras.splice(index, 1);
        console.log(`Removed ${loraName} from favorites for user ${user}`);
    }

    // Redisplay the lora detail page with updated favorite status
    await displayLoraDetail(message, loraName, user);
};

module.exports = {
    displayLoraMenu,
    displayLoraCategory,
    handleLoraCallback,
    handleLoraSearch
};
