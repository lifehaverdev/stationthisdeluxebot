const {BaseDB} = require('./BaseDB');

class UserCoreDB extends BaseDB {
    constructor() {
        super('users_core');
    }

    // Data massager - extracts only core-relevant fields
    massageData(data) {
        return {
            userId: data.userId,
            wallets: data.wallets || [],
            wallet: data.wallet || '',
            verified: data.verified || false,
            kickedAt: data.kickedAt || '',
            lastRunTime: data.lastRunTime || new Date(),
            lastTouch: data.lastTouch || new Date(),
            createdAt: data.createdAt || new Date(),
            apiKey: data.apiKey || null,
            apiKeyCreatedAt: data.apiKeyCreatedAt || null,
        };
    }

    async writeUserData(userId, data) {
        const coreData = this.massageData(data);
        return this.updateOne(
            { userId },
            coreData,
        );
    }
    writeUserDataPoint(userId, field, value, batch = false) {  // Remove async
        if (batch) {
            this.updateOne(
                { userId },
                { [field]: value },
                {},
                true  // batch mode
            );
            console.log('writeUserDataPoint batch mode:', batch);
            console.log('writeUserDataPoint returning: this');
            return this;
        }
    
        // Non-batch mode
        return this.updateOne(
            { userId },
            { [field]: value },
            {},
            false
        );
    }

    // For new users - creates initial document
    async writeNewUserData(userId, data) {
        const coreData = this.massageData(data);
        return this.updateOne(
            { userId },
            coreData,
            { upsert: true }  // Only use upsert here for new users
        );
    }

    async getUsersByWallet(walletAddress) {
        return this.findMany({ wallet: walletAddress });
    }
}

module.exports = UserCoreDB;