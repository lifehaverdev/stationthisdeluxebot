/**
 * Dashboard Menu Manager for Telegram
 * 
 * Handles the display and interaction logic for the /account command.
 */

const {
    sendEscapedMessage,
    editEscapedMessageText
} = require('../utils/messaging');

/**
 * Handles the /account command.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} msg - The incoming message object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies (logger, internal api client, etc.).
 */
async function handleAccountCommand(bot, msg, masterAccountId, dependencies) {
    const { logger } = dependencies;
    logger.info(`[DashboardMenu] /account command received from MAID: ${masterAccountId}`);
    await displayMainMenu(bot, msg, masterAccountId, dependencies, false);
}

/**
 * Handles callback queries for the account dashboard menus.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} callbackQuery - The callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 */
async function handleDashboardCallback(bot, callbackQuery, masterAccountId, dependencies) {
    const { logger } = dependencies;
    const data = callbackQuery.data;
    const [action, ...params] = data.split(':');

    logger.info(`[DashboardMenu] handleDashboardCallback received: ${data} from MAID: ${masterAccountId}`);

    if (action !== 'dash') return;

    const subAction = params[0];

    switch (subAction) {
        case 'main':
            await displayMainMenu(bot, callbackQuery, masterAccountId, dependencies, true);
            break;
        case 'history':
            const [unit, offsetStr] = params.slice(1);
            await displayHistoryOverview(bot, callbackQuery, masterAccountId, dependencies, true, unit, parseInt(offsetStr, 10));
            break;
        case 'history_filter':
            const [filterUnit, filterOffsetStr] = params.slice(1);
            await displayHistoryFilterMenu(bot, callbackQuery, masterAccountId, dependencies, true, filterUnit, parseInt(filterOffsetStr, 10));
            break;
        case 'history_by_tool':
            const [toolUnit, toolOffsetStr] = params.slice(1);
            await displayHistoryByToolMenu(bot, callbackQuery, masterAccountId, dependencies, true, toolUnit, parseInt(toolOffsetStr, 10));
            break;
        case 'history_by_session':
            const [sessionUnit, sessionOffsetStr] = params.slice(1);
            await displayHistoryBySessionMenu(bot, callbackQuery, masterAccountId, dependencies, true, sessionUnit, parseInt(sessionOffsetStr, 10));
            break;
        case 'referral':
            // Placeholder for referral menu
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Referral info coming soon!', show_alert: true });
            break;
        case 'settings':
             // Placeholder for settings menu
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Settings coming soon!', show_alert: true });
            break;
        case 'connect':
            // Placeholder for connect menu
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Connection management coming soon!', show_alert: true });
            break;
        case 'help':
            // Placeholder for help menu
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Help section coming soon!', show_alert: true });
            break;
        case 'close':
            await bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id);
            await bot.answerCallbackQuery(callbackQuery.id);
            break;
        case 'noop':
            await bot.answerCallbackQuery(callbackQuery.id);
            break;
        default:
            logger.warn(`[DashboardMenu] Unknown sub-action: ${subAction}`);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action.' });
            break;
    }
}

/**
 * Displays the main account dashboard menu.
 * @param {Object} bot - The Telegram bot instance.
 * @param {Object} messageOrQuery - The incoming message or callback query object.
 * @param {string} masterAccountId - The user's master account ID.
 * @param {Object} dependencies - Shared dependencies.
 * @param {boolean} isEdit - Whether to edit the message or send a new one.
 */
async function displayMainMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = false) {
    const { logger, internal } = dependencies;
    const chatId = isEdit ? messageOrQuery.message.chat.id : messageOrQuery.chat.id;
    const messageId = isEdit ? messageOrQuery.message.message_id : null;
    const username = messageOrQuery.from.username || messageOrQuery.from.first_name;

    try {
        // Fetch all data in parallel
        const [userRes, economyRes, transactionsRes] = await Promise.all([
            internal.client.get(`/internal/v1/data/users/${masterAccountId}`),
            internal.client.get(`/internal/v1/data/users/${masterAccountId}/economy`),
            internal.client.get(`/internal/v1/data/users/${masterAccountId}/transactions`)
        ]);

        const user = userRes.data;
        const economy = economyRes.data;
        const transactions = transactionsRes.data;

        // --- Process Data ---
        let walletStatus = 'Not Connected';
        const primaryWallet = user.wallets?.find(w => w.isPrimary);

        if (primaryWallet) {
            const addr = primaryWallet.address;
            walletStatus = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        } else if (user.wallets?.length > 0) {
            // Fallback to the first wallet if no primary is set
            const addr = user.wallets[0].address;
            walletStatus = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        }
        
        // XP and Level - exp is in the economy object, not userCore
        const totalExp = parseFloat(economy.exp?.$numberDouble || economy.exp || 0);
        const level = Math.floor(Math.cbrt(totalExp));
        const nextLevelExp = (level + 1) ** 3;
        const lastLevelExp = level ** 3;
        const expToNextLevel = nextLevelExp - lastLevelExp;
        const userExpInLevel = totalExp - lastLevelExp;
        const levelProgressRatio = expToNextLevel > 0 ? userExpInLevel / expToNextLevel : 0;

        let progressBar = '🟩';
        for (let i = 0; i < 6; i++) {
            progressBar += i < levelProgressRatio * 6 ? '🟩' : '⬜️';
        }

        // The economy API returns BSON types as objects, so we access the value inside.
        const pointsBalance = parseFloat(economy.usdCredit?.$numberDecimal || economy.usdCredit || '0').toFixed(4);

        // Aggregate earnings from transactions
        const calculateEarnings = (type) => transactions
            .filter(t => t.transactionType === type && parseFloat(t.amountUsd) > 0)
            .reduce((sum, t) => sum + parseFloat(t.amountUsd), 0)
            .toFixed(4);

        const referralEarnings = calculateEarnings('referral_bonus');
        const modelEarnings = calculateEarnings('model_reward'); // Assuming this transactionType
        const spellEarnings = calculateEarnings('spell_reward'); // Assuming this transactionType
        
        // --- Build Message ---
        const text = [
            `*${username}*`,
            `Wallet: \`${walletStatus}\``,
            ``,
            `Level: ${level}`,
            `EXP: ${progressBar}`,
            ``,
            `Points: \`${pointsBalance}\``,
            `Lifetime Referral Rewards: \`${referralEarnings}\``,
            `Lifetime Model Rewards: \`${modelEarnings}\``,
            `Lifetime Spell Rewards: \`${spellEarnings}\``,
        ].join('\n');

        // --- Build Keyboard ---
        const keyboard = [
            [{ text: 'Connect', callback_data: 'dash:connect' }, { text: 'History', callback_data: 'dash:history' }],
            [{ text: 'Referral', callback_data: 'dash:referral' }, { text: 'Settings', callback_data: 'dash:settings' }],
            [{ text: 'ℹ', callback_data: 'dash:help' }, { text: 'Ⓧ', callback_data: 'dash:close' }]
        ];
        
        const reply_markup = { inline_keyboard: keyboard };

        if (isEdit) {
            await editEscapedMessageText(bot, text, { chat_id: chatId, message_id: messageId, reply_markup });
            await bot.answerCallbackQuery(messageOrQuery.id);
        } else {
            await sendEscapedMessage(bot, chatId, text, { reply_markup });
        }

    } catch (error) {
        logger.error(`[DashboardMenu] Error displaying main menu for MAID ${masterAccountId}:`, error);
        const errorMessage = 'Sorry, your account dashboard is currently unavailable.';
        if (isEdit) {
            await bot.answerCallbackQuery(messageOrQuery.id, { text: errorMessage, show_alert: true });
        } else {
            await sendEscapedMessage(bot, chatId, errorMessage);
        }
    }
}

async function displayHistoryOverview(bot, messageOrQuery, masterAccountId, dependencies, isEdit = true, timeUnit = 'month', offset = 0) {
    const { logger, internal } = dependencies;
    const chatId = isEdit ? messageOrQuery.message.chat.id : messageOrQuery.chat.id;
    const messageId = isEdit ? messageOrQuery.message.message_id : null;

    // Sanitize inputs
    const validUnits = ['day', 'week', 'month'];
    timeUnit = validUnits.includes(timeUnit) ? timeUnit : 'month';
    offset = !isNaN(offset) ? offset : 0;

    try {
        // --- 1. Calculate Timeframe ---
        const getZoomLevels = (unit) => {
            const levels = ['day', 'week', 'month'];
            const currentIndex = levels.indexOf(unit);
            return {
                in: currentIndex > 0 ? levels[currentIndex - 1] : null,
                out: currentIndex < levels.length - 1 ? levels[currentIndex + 1] : null,
            };
        };

        const now = new Date();
        let endDate = new Date(now);
        let startDate;

        // More robust date calculations
        if (timeUnit === 'month') {
            endDate.setMonth(now.getMonth() - offset);
            startDate = new Date(endDate);
            startDate.setMonth(startDate.getMonth() - 1);
        } else {
            const unitDays = timeUnit === 'week' ? 7 : 1;
            const dayOffset = offset * unitDays;
            endDate.setDate(now.getDate() - dayOffset);
            startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - unitDays);
        }

        // --- 2. Fetch Data ---
        const generationsRes = await internal.client.get(`/internal/v1/data/generations`, {
            params: {
                masterAccountId,
                requestTimestamp_gte: startDate.toISOString(),
                requestTimestamp_lte: endDate.toISOString()
            }
        });
        const generations = generationsRes.data.generations || [];

        // --- 3. Calculate Stats ---
        const totalSpent = generations
            .reduce((sum, gen) => sum + parseFloat(gen.costUsd?.$numberDecimal || gen.costUsd || 0), 0)
            .toFixed(4);

        let mostUsedTool = 'N/A';
        if (generations.length > 0) {
            const toolCounts = generations.reduce((counts, gen) => {
                const tool = gen.metadata?.displayName || gen.serviceName || 'Unknown';
                counts[tool] = (counts[tool] || 0) + 1;
                return counts;
            }, {});
            mostUsedTool = Object.keys(toolCounts).reduce((a, b) => toolCounts[a] > toolCounts[b] ? a : b);
        }

        // --- 4. Build Message ---
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const text = [
            `*Usage History: ${timeUnit.charAt(0).toUpperCase() + timeUnit.slice(1)} View*`,
            `_${fromDateStr} - ${toDateStr}_`,
            ``,
            `Total Spent: \`${totalSpent}\` points`,
            `Most Used Tool: \`${mostUsedTool}\``
        ].join('\n');

        // --- 5. Build Keyboard ---
        const zoom = getZoomLevels(timeUnit);
        
        const navRow = [];
        navRow.push({ text: '←', callback_data: `dash:history:${timeUnit}:${offset + 1}` });
        
        // Calculate offset for zoom buttons based on the current view's end date.
        const oneDay = 1000 * 60 * 60 * 24;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDay = new Date(endDate);
        endDay.setHours(0, 0, 0, 0);

        const dayDifference = Math.round((today - endDay) / oneDay);
        
        const zoomInCallback = zoom.in 
            ? `dash:history:${zoom.in}:${dayDifference}` 
            : 'dash:noop';

        const zoomOutUnitDays = zoom.out === 'week' ? 7 : 30; // Approximation for month
        const zoomOutOffset = zoom.out 
            ? Math.floor(dayDifference / zoomOutUnitDays)
            : 0;
            
        const zoomOutCallback = zoom.out 
            ? `dash:history:${zoom.out}:${zoomOutOffset}` 
            : 'dash:noop';

        navRow.push({ text: '↘︎', callback_data: zoomInCallback });
        navRow.push({ text: '↖︎', callback_data: zoomOutCallback });
        
        if (offset > 0) {
            navRow.push({ text: '→', callback_data: `dash:history:${timeUnit}:${offset - 1}` });
        } else {
            //navRow.push({ text: '⚪', callback_data: 'dash:noop' });
        }
        
        const keyboard = [
            navRow,
            [{ text: '⏚ Filter', callback_data: `dash:history_filter:${timeUnit}:${offset}` }],
            [{ text: '⇱', callback_data: 'dash:main' }, { text: 'Ⓧ', callback_data: 'dash:close' }]
        ];
        const reply_markup = { inline_keyboard: keyboard };

        if (isEdit) {
            await editEscapedMessageText(bot, text, { chat_id: chatId, message_id: messageId, reply_markup, parse_mode: 'MarkdownV2' });
            await bot.answerCallbackQuery(messageOrQuery.id);
        } else {
            await sendEscapedMessage(bot, chatId, text, { reply_markup, parse_mode: 'MarkdownV2' });
        }
    } catch (error) {
        logger.error(`[DashboardMenu] Error displaying history overview for MAID ${masterAccountId}:`, error);
        const errorMessage = 'Sorry, your usage history is currently unavailable.';
        if (isEdit) {
            await bot.answerCallbackQuery(messageOrQuery.id, { text: errorMessage, show_alert: true });
        } else {
            await sendEscapedMessage(bot, chatId, errorMessage);
        }
    }
}

// TODO: Expand filter menu to support advanced filtering (multi-select, tool/session/date, etc.)
//       Consider adding persistent filter state and more granular breakdowns.

async function displayHistoryFilterMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = true, timeUnit, offset) {
    const { logger } = dependencies;
    const chatId = isEdit ? messageOrQuery.message.chat.id : messageOrQuery.chat.id;
    const messageId = isEdit ? messageOrQuery.message.message_id : null;

    logger.info(`[DashboardMenu] Displaying filter menu for ${timeUnit} at offset ${offset}`);

    try {
        const text = `*Filter History*
        
Select a filter to apply to the current time period.`;

        const keyboard = [
            [{ text: 'By Tool', callback_data: `dash:history_by_tool:${timeUnit}:${offset}` }],
            [{ text: 'By Session', callback_data: `dash:history_by_session:${timeUnit}:${offset}` }],
            [{ text: '⇤ Back', callback_data: `dash:history:${timeUnit}:${offset}` }]
        ];
        const reply_markup = { inline_keyboard: keyboard };

        if (isEdit) {
            await editEscapedMessageText(bot, text, { chat_id: chatId, message_id: messageId, reply_markup, parse_mode: 'MarkdownV2' });
            await bot.answerCallbackQuery(messageOrQuery.id);
        } else {
            await sendEscapedMessage(bot, chatId, text, { reply_markup, parse_mode: 'MarkdownV2' });
        }
    } catch (error) {
        logger.error(`[DashboardMenu] Error displaying history filter menu for MAID ${masterAccountId}:`, error);
        const errorMessage = 'Sorry, the filter menu is currently unavailable.';
        if (isEdit) {
            await bot.answerCallbackQuery(messageOrQuery.id, { text: errorMessage, show_alert: true });
        } else {
            await sendEscapedMessage(bot, chatId, errorMessage);
        }
    }
}

async function displayHistoryByToolMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = true, timeUnit, offset) {
    const { logger, internal } = dependencies;
    const chatId = messageOrQuery.message.chat.id;
    const messageId = messageOrQuery.message.message_id;

    try {
        const { startDate, endDate } = calculateTimeframe(timeUnit, offset);
        
        const generationsRes = await internal.client.get(`/internal/v1/data/generations`, {
            params: {
                masterAccountId,
                requestTimestamp_gte: startDate.toISOString(),
                requestTimestamp_lte: endDate.toISOString()
            }
        });
        const generations = generationsRes.data.generations || [];

        const toolStats = generations.reduce((stats, gen) => {
            const toolName = gen.metadata?.displayName || gen.serviceName || 'Unknown';
            if (!stats[toolName]) {
                stats[toolName] = { count: 0, totalCost: 0 };
            }
            stats[toolName].count++;
            stats[toolName].totalCost += parseFloat(gen.costUsd?.$numberDecimal || gen.costUsd || 0);
            return stats;
        }, {});

        let messageLines = [
            `*Usage by Tool: ${timeUnit} View*`,
            `_${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}_`,
            ``
        ];
        
        if (Object.keys(toolStats).length === 0) {
            messageLines.push('No usage data available for this period.');
        } else {
            const sortedTools = Object.entries(toolStats).sort(([,a], [,b]) => b.count - a.count);
            for (const [toolName, stats] of sortedTools) {
                messageLines.push(`*${toolName}*`);
                messageLines.push(`  Uses: ${stats.count}, Spent: \`${stats.totalCost.toFixed(4)}\``);
            }
        }
        
        const text = messageLines.join('\n');
        const keyboard = [[{ text: '⇤ Back to Filters', callback_data: `dash:history_filter:${timeUnit}:${offset}` }]];
        const reply_markup = { inline_keyboard: keyboard };

        await editEscapedMessageText(bot, text, { chat_id: chatId, message_id: messageId, reply_markup, parse_mode: 'MarkdownV2' });
        await bot.answerCallbackQuery(messageOrQuery.id);

    } catch (error) {
        logger.error(`[DashboardMenu] Error displaying history by tool menu for MAID ${masterAccountId}:`, error);
        await bot.answerCallbackQuery(messageOrQuery.id, { text: 'Error fetching tool history.', show_alert: true });
    }
}

async function displayHistoryBySessionMenu(bot, messageOrQuery, masterAccountId, dependencies, isEdit = true, timeUnit, offset) {
    const { logger, internal } = dependencies;
    const chatId = messageOrQuery.message.chat.id;
    const messageId = messageOrQuery.message.message_id;

    try {
        const { startDate, endDate } = calculateTimeframe(timeUnit, offset);

        const generationsRes = await internal.client.get(`/internal/v1/data/generations`, {
            params: { masterAccountId, requestTimestamp_gte: startDate.toISOString(), requestTimestamp_lte: endDate.toISOString() }
        });
        const generations = generationsRes.data.generations || [];

        const sessionStats = generations.reduce((stats, gen) => {
            const sessionId = gen.sessionId;
            if (!sessionId) return stats;
            if (!stats[sessionId]) {
                stats[sessionId] = { count: 0, totalCost: 0, timestamps: [] };
            }
            stats[sessionId].count++;
            stats[sessionId].totalCost += parseFloat(gen.costUsd?.$numberDecimal || gen.costUsd || 0);
            stats[sessionId].timestamps.push(new Date(gen.requestTimestamp?.$date?.$numberLong ? parseInt(gen.requestTimestamp.$date.$numberLong) : gen.requestTimestamp));
            return stats;
        }, {});
        
        let messageLines = [
            `*Usage by Session: ${timeUnit} View*`,
            `_${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}_`,
            ``,
            `_Showing last 5 sessions in this period_`,
            ``
        ];
        
        const sortedSessionIds = Object.keys(sessionStats).sort((a, b) => Math.max(...sessionStats[b].timestamps.map(t => t.getTime())) - Math.max(...sessionStats[a].timestamps.map(t => t.getTime())));

        if (sortedSessionIds.length === 0) {
            messageLines.push('No session data available for this period.');
        } else {
            const recentSessions = sortedSessionIds.slice(0, 5);
            for (const sessionId of recentSessions) {
                const session = sessionStats[sessionId];
                const startTime = new Date(Math.min(...session.timestamps.map(t => t.getTime())));
                messageLines.push(`*Session on ${startTime.toLocaleString()}*`);
                messageLines.push(`  Generations: ${session.count}, Spent: \`${session.totalCost.toFixed(4)}\``);
            }
        }
        
        const text = messageLines.join('\n');
        const keyboard = [[{ text: '⇤ Back to Filters', callback_data: `dash:history_filter:${timeUnit}:${offset}` }]];
        const reply_markup = { inline_keyboard: keyboard };

        await editEscapedMessageText(bot, text, { chat_id: chatId, message_id: messageId, reply_markup, parse_mode: 'MarkdownV2' });
        await bot.answerCallbackQuery(messageOrQuery.id);

    } catch (error) {
        logger.error(`[DashboardMenu] Error displaying history by session menu for MAID ${masterAccountId}:`, error);
        await bot.answerCallbackQuery(messageOrQuery.id, { text: 'Error fetching session history.', show_alert: true });
    }
}

function calculateTimeframe(timeUnit, offset) {
    const now = new Date();
    let endDate = new Date(now);
    let startDate;

    if (timeUnit === 'month') {
        endDate.setMonth(now.getMonth() - offset);
        startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - 1);
    } else {
        const unitDays = timeUnit === 'week' ? 7 : 1;
        const dayOffset = offset * unitDays;
        endDate.setDate(now.getDate() - dayOffset);
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - unitDays);
    }
    return { startDate, endDate };
}

/**
 * Registers all handlers for the account dashboard feature.
 * @param {object} dispatcherInstances - The command/callback dispatchers.
 * @param {object} dependencies - The canonical dependencies object.
 */
function registerHandlers(dispatcherInstances, dependencies) {
    const { commandDispatcher, callbackQueryDispatcher } = dispatcherInstances;
    const { logger, internal } = dependencies;

    // Command to initiate the account dashboard
    const accountCommandHandler = (bot, msg) => {
        // Resolve masterAccountId first, as it's not available in the command dispatcher context
        internal.client.post('/internal/v1/data/users/find-or-create', {
            platform: 'telegram',
            platformId: msg.from.id.toString(),
            platformContext: { firstName: msg.from.first_name, username: msg.from.username }
        }).then(response => {
            const masterAccountId = response.data.masterAccountId;
            if (masterAccountId) {
                handleAccountCommand(bot, msg, masterAccountId, dependencies);
            } else {
                 logger.error(`[DashboardMenu] registerHandlers: Could not resolve masterAccountId for user ${msg.from.id}.`);
                 bot.sendMessage(msg.chat.id, "I couldn't identify your account. Please try again or contact support.", { reply_to_message_id: msg.message_id });
            }
        }).catch(error => {
            logger.error(`[DashboardMenu] registerHandlers: Error resolving masterAccountId for user ${msg.from.id}:`, error);
            bot.sendMessage(msg.chat.id, "I couldn't identify your account due to an error. Please try again later.", { reply_to_message_id: msg.message_id });
        });
    };
    commandDispatcher.register(/^\/account(?:@\w+)?$/, accountCommandHandler);

    // Callbacks for navigating the dashboard. The dispatcher resolves the masterAccountId for callbacks.
    const dashboardCallbackHandler = (bot, query, masterAccountId) => handleDashboardCallback(bot, query, masterAccountId, dependencies);
    callbackQueryDispatcher.register('dash', dashboardCallbackHandler);
    
    logger.info('[DashboardMenuManager] All handlers registered.');
}


module.exports = {
    registerHandlers
}; 