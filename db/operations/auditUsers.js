const { UserCore, UserEconomy, UserPref } = require('../index');
require('dotenv').config();

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

async function auditUserCollections() {
    try {
        console.log('Starting user collections audit...');
        
        const coreUsers = await userCore.findMany({});
        const economyUsers = await userEconomy.findMany({});
        const prefUsers = await userPref.findMany({});
        
        console.log(`Found ${coreUsers.length} core users`);
        console.log(`Found ${economyUsers.length} economy users`);
        console.log(`Found ${prefUsers.length} preference users`);
        
        // Create maps for easier lookup
        const economyMap = new Map(economyUsers.map(user => [user.userId, user]));
        const prefMap = new Map(prefUsers.map(user => [user.userId, user]));
        
        // Find users missing from each collection
        const missingEconomy = coreUsers.filter(core => !economyMap.has(core.userId));
        const missingPref = coreUsers.filter(core => !prefMap.has(core.userId));
        
        // Find users missing from both collections
        const missingBoth = coreUsers.filter(core => 
            !economyMap.has(core.userId) && !prefMap.has(core.userId)
        );

        // Analysis of patterns...
        const analysis = {
            total: {
                missingEconomy: missingEconomy.length,
                missingPref: missingPref.length,
                missingBoth: missingBoth.length
            },
            hasWallet: 0,
            noWallet: 0,
            createdAtCounts: {},
            lastTouchCounts: {},
            timeRanges: {
                lastDay: 0,
                lastWeek: 0,
                lastMonth: 0,
                older: 0
            }
        };

        const now = new Date();
        const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        missingEconomy.forEach(user => {
            // Wallet analysis
            if (user.wallet && user.wallet !== '') {
                analysis.hasWallet++;
            } else {
                analysis.noWallet++;
            }

            // Creation date analysis
            const createdDate = user.createdAt ? new Date(user.createdAt).toDateString() : 'undefined';
            analysis.createdAtCounts[createdDate] = (analysis.createdAtCounts[createdDate] || 0) + 1;

            // Last touch analysis
            const lastTouchDate = user.lastTouch ? new Date(user.lastTouch).toDateString() : 'undefined';
            analysis.lastTouchCounts[lastTouchDate] = (analysis.lastTouchCounts[lastTouchDate] || 0) + 1;

            // Time range analysis
            if (user.createdAt) {
                const created = new Date(user.createdAt);
                if (created > dayAgo) analysis.timeRanges.lastDay++;
                else if (created > weekAgo) analysis.timeRanges.lastWeek++;
                else if (created > monthAgo) analysis.timeRanges.lastMonth++;
                else analysis.timeRanges.older++;
            }
        });

        console.log('\n=== Analysis of Missing Entries ===');
        console.log(`Users missing Economy: ${analysis.total.missingEconomy}`);
        console.log(`Users missing Preferences: ${analysis.total.missingPref}`);
        console.log(`Users missing Both: ${analysis.total.missingBoth}`);
        
        if (missingBoth.length > 0) {
            console.log('\nSample of users missing both collections:');
            missingBoth.slice(0, 5).forEach(user => {
                console.log(`\nUserID: ${user.userId}`);
                console.log('Created:', user.createdAt);
                console.log('Last Touch:', user.lastTouch);
                console.log('Has Wallet:', !!user.wallet);
            });
        }

        console.log('\n=== Analysis of Users Missing Economy Entries ===');
        console.log(`Total users affected: ${analysis.total.missingEconomy}`);
        console.log(`Users with wallets: ${analysis.hasWallet}`);
        console.log(`Users without wallets: ${analysis.noWallet}`);
        
        console.log('\nCreation Date Distribution:');
        Object.entries(analysis.createdAtCounts)
            .sort((a, b) => b[1] - a[1])  // Sort by count, highest first
            .forEach(([date, count]) => {
                console.log(`${date}: ${count} users`);
            });

        console.log('\nLast Touch Distribution:');
        Object.entries(analysis.lastTouchCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([date, count]) => {
                console.log(`${date}: ${count} users`);
            });

        console.log('\nTime Range Analysis:');
        console.log(`Created in last 24 hours: ${analysis.timeRanges.lastDay}`);
        console.log(`Created in last week: ${analysis.timeRanges.lastWeek}`);
        console.log(`Created in last month: ${analysis.timeRanges.lastMonth}`);
        console.log(`Created more than a month ago: ${analysis.timeRanges.older}`);

        return {
            missingEconomy,
            missingPref,
            missingBoth
        };
    } catch (error) {
        console.error('Audit failed:', error);
        throw error;
    }
}

// Run the audit
auditUserCollections()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });