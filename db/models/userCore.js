const {BaseDB} = require('./BaseDB');

class UserCoreDB extends BaseDB {
    constructor() {
        super('users_core');
    }

    // Data massager - extracts only core-relevant fields
    massageData(data) {
        return {
            userId: data.userId,
            wallet: data.wallet || '',
            ethWallet: data.ethWallet || '',
            verified: data.verified || false,
            ethVerified: data.ethVerified || false,
            createdAt: data.createdAt || new Date(),
            lastTouch: data.lastTouch || new Date(),
            kickedAt: data.kickedAt || ''
        };
    }

    async writeUserData(userId, data) {
        const coreData = this.massageData(data);
        return this.updateOne(
            { userId },
            coreData,
        );
    }

    async writeUserDataPoint(userId, field, value) {
        return this.updateOne(
            { userId },
            { [field]: value }
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