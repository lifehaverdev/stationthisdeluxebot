const { sendMessage, DEV_DMS } = require('../../utils');
const { commandRegistry } = require('../bot');
const UserCoreDB = require('../../../db/models/userCore');
const UserStats = require('../../../db/models/userStats');
const { AnalyticsEvents, EVENT_TYPES } = require('../../../db/models/analyticsEvents');

commandRegistry['/stats'] = {
    handler: iStats,
};

async function getStats() {
    console.log('🔍 Starting stats collection...');
    const userCore = new UserCoreDB();
    const userStats = new UserStats();
    const analytics = new AnalyticsEvents();

    // 1. User Statistics - now with distinct userId and growth rates
    console.log('👥 Collecting user statistics...');
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    
    // Get all users and deduplicate by userId
    const allUsers = await userCore.findMany({});
    const uniqueUserIds = new Set(allUsers.map(user => user.userId));
    const totalUsers = uniqueUserIds.size;

    // Get new users from this week and deduplicate
    const thisWeekUsers = await userCore.findMany({ 
        createdAt: { $gte: oneWeekAgo } 
    });
    const uniqueNewUserIds = new Set(thisWeekUsers.map(user => user.userId));
    const newUsers = uniqueNewUserIds.size;

    // Get new users from previous week and deduplicate
    const lastWeekUsers = await userCore.findMany({
        createdAt: { 
            $gte: twoWeeksAgo,
            $lt: oneWeekAgo
        }
    });
    const uniqueLastWeekUserIds = new Set(lastWeekUsers.map(user => user.userId));
    const lastWeekNewUsers = uniqueLastWeekUserIds.size;
    
    // Calculate growth rates
    const weeklyGrowthRate = lastWeekNewUsers > 0 
        ? (((newUsers - lastWeekNewUsers) / lastWeekNewUsers) * 100).toFixed(1)
        : newUsers > 0 ? 100 : 0;

    // Calculate percentage of total users for each week
    const thisWeekPercent = ((newUsers / totalUsers) * 100).toFixed(1);
    const lastWeekPercent = ((lastWeekNewUsers / totalUsers) * 100).toFixed(1);

    console.log(`Found ${totalUsers} total unique users`);
    console.log(`New users this week: ${newUsers} (${thisWeekPercent}% of total)`);
    console.log(`New users last week: ${lastWeekNewUsers} (${lastWeekPercent}% of total)`);
    console.log(`Weekly growth rate: ${weeklyGrowthRate}%`);

    // 2. Command & Menu Usage Heatmap - last 24h
    console.log('📊 Collecting interaction heatmap...');
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Get both commands and menu interactions
    const commandUsage = await analytics.findMany({
        type: EVENT_TYPES.COMMAND,
        timestamp: { $gte: last24Hours }
    });
    console.log(`Found ${commandUsage.length} command events in last 24h`);

    const menuUsage = await analytics.findMany({
        type: EVENT_TYPES.MENU,
        timestamp: { $gte: last24Hours }
    });
    console.log(`Found ${menuUsage.length} menu events in last 24h`);

    // Combine command and menu usage into heatmap
    const usageHeatmap = {};
    
    // Process commands
    commandUsage.forEach(event => {
        const cmd = event.data.command;
        usageHeatmap[cmd] = (usageHeatmap[cmd] || 0) + 1;
    });

    // Process menu interactions
    menuUsage.forEach(event => {
        const action = event.data.action;
        usageHeatmap[action] = (usageHeatmap[action] || 0) + 1;
    });

    // 3. Generation Statistics
    const recentGens = await analytics.findMany({
        type: EVENT_TYPES.GENERATION,
        timestamp: { $gte: last24Hours }
    });

    const totalGens24h = recentGens.length;

    // Find top 3 generators
    const gensByUser = recentGens.reduce((acc, curr) => {
        const username = curr.username || 'Unknown';
        acc[username] = (acc[username] || 0) + 1;
        return acc;
    }, {});

    const topGenners = Object.entries(gensByUser)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)  // Get top 3
        .map(([username, count]) => ({username, count}));

    return {
        users: {
            total: totalUsers,
            newLastWeek: newUsers,
            lastWeekNewUsers,
            thisWeekPercent,
            lastWeekPercent,
            weeklyGrowthRate
        },
        interactions: usageHeatmap,
        generations: {
            last24h: totalGens24h,
            topGenners  // Now returning array of top 3
        }
    };
}

async function iStats(message) {
    try {
        console.log('📈 iStats command triggered');
        const stats = await getStats();
        
        let text;
        
        if (message.chat.id === DEV_DMS) {
            // Full stats for dev
            text = `📊 *Bot Statistics*\n\n` +
                `👥 *Users*\n` +
                `Total: ${stats.users.total}\n` +
                `New this week: ${stats.users.newLastWeek} (${stats.users.thisWeekPercent}% of total)\n` +
                `Previous week: ${stats.users.lastWeekNewUsers} (${stats.users.lastWeekPercent}% of total)\n` +
                `Weekly growth: ${stats.users.weeklyGrowthRate}%\n\n` +
                `🎯 *Interaction Usage (24h)*\n` +
                Object.entries(stats.interactions)
                    .sort(([,a], [,b]) => b - a)  // Sort by usage count
                    .slice(0, 10)  // Show top 10 most used
                    .map(([action, count]) => `${action}: ${count}`)
                    .join('\n') + '\n\n' +
                `🎨 *Generations (24h)*\n` +
                `Total: ${stats.generations.last24h}\n` +
                `Top Generators:\n` +
                stats.generations.topGenners
                    .map((genner, i) => `${i + 1}. ${genner.username} (${genner.count})`)
                    .join('\n');
        } else {
            // Limited stats for regular users
            text = `🎨 *Generation Statistics (24h)*\n\n` +
                `Total: ${stats.generations.last24h}\n` +
                `Top Generators:\n` +
                stats.generations.topGenners
                    .map((genner, i) => `${i + 1}. ${genner.username} (${genner.count})`)
                    .join('\n');
        }

        console.log('✅ Stats collected successfully, sending message');
        await sendMessage(message, escapeMarkdown(text), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        console.error('❌ Error in iStats:', error);
        await sendMessage(message, 'Error fetching statistics');
    }
}

const escapeMarkdown = (text) => {
    if (!text) return '';
    return text.replace(/[_[\]()~`>#+=|{}.!-]/g, '\\$&');
};

module.exports = iStats;
