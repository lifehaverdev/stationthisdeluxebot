const { UserCore, UserEconomy, UserPref } = require('../index');
const { 
    defaultUserData,
    defaultUserCore,
    defaultUserEconomy,
    defaultUserPref,
    validateUserData 
} = require('../../utils/users/defaultUserData');
require('dotenv').config();

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

async function findUsersNeedingRepair() {
    const coreUsers = await userCore.findMany({});
    const economyUsers = await userEconomy.findMany({});
    const prefUsers = await userPref.findMany({});
    
    console.log(`Found ${coreUsers.length} core users`);
    console.log(`Found ${economyUsers.length} economy users`);
    console.log(`Found ${prefUsers.length} preference users`);
    
    const economyMap = new Map(economyUsers.map(user => [user.userId, user]));
    const prefMap = new Map(prefUsers.map(user => [user.userId, user]));
    
    const missingBoth = coreUsers.filter(core => 
        !economyMap.has(core.userId) && !prefMap.has(core.userId)
    );

    console.log(`Found ${missingBoth.length} users missing both economy and preference documents`);
    return missingBoth;
}

async function repairSingleUser(targetUserId) {
    try {
        console.log(`\nRepairing user ${targetUserId}...`);
        
        const coreUser = await userCore.findOne({ userId: targetUserId });
        if (!coreUser) {
            throw new Error(`No core user found with ID ${targetUserId}`);
        }
        
        const userData = {
            ...defaultUserData,
            ...coreUser,
            userId: targetUserId,
            createdAt: coreUser.createdAt || new Date(),
            lastTouch: coreUser.lastTouch || new Date()
        };
        
        const validatedData = validateUserData(userData);
        
        let repairCount = {
            economy: 0,
            preferences: 0,
            errors: 0
        };

        try {
            await userEconomy.writeNewUserData(targetUserId, validatedData);
            repairCount.economy++;
        } catch (e) {
            console.error('Failed to write economy document:', e);
            repairCount.errors++;
        }
        
        try {
            await userPref.writeNewUserData(targetUserId, validatedData);
            repairCount.preferences++;
        } catch (e) {
            console.error('Failed to write preferences document:', e);
            repairCount.errors++;
        }
        
        return repairCount;
    } catch (error) {
        console.error('Repair process failed for user:', targetUserId, error);
        throw error;
    }
}

async function repairAllUsers() {
    try {
        const usersToRepair = await findUsersNeedingRepair();
        
        console.log(`\nStarting repair for ${usersToRepair.length} users...`);
        
        let totalRepairs = {
            economy: 0,
            preferences: 0,
            errors: 0,
            skipped: 0
        };

        for (const user of usersToRepair) {
            try {
                const result = await repairSingleUser(user.userId);
                totalRepairs.economy += result.economy;
                totalRepairs.preferences += result.preferences;
                totalRepairs.errors += result.errors;
            } catch (error) {
                totalRepairs.errors++;
                totalRepairs.skipped++;
                console.error(`Skipping user ${user.userId} due to error`);
            }
        }
        
        console.log('\n=== Repair Summary ===');
        console.log(`Total users processed: ${usersToRepair.length}`);
        console.log(`Economy documents created: ${totalRepairs.economy}`);
        console.log(`Preference documents created: ${totalRepairs.preferences}`);
        console.log(`Errors encountered: ${totalRepairs.errors}`);
        console.log(`Users skipped: ${totalRepairs.skipped}`);
        
        return totalRepairs;
    } catch (error) {
        console.error('Repair process failed:', error);
        throw error;
    }
}

// Export the functions instead of running them
module.exports = {
    findUsersNeedingRepair,
    repairSingleUser,
    repairAllUsers
};

/* Commented out automatic execution
console.log('Starting repair process...');
repairAllUsers()
    .then(() => {
        console.log('Repair process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('Repair process failed:', error);
        process.exit(1);
    });
*/