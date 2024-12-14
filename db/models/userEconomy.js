const {BaseDB} = require('./BaseDB');

class UserEconomyDB extends BaseDB {
    constructor() {
        super('users_economy');
    }

    // Data massager - extracts only economy-relevant fields
    massageData(data) {
        return {
            userId: data.userId,
            balance: data.balance || '0',
            exp: data.exp || 0,
            points: data.points || 0,
            doints: data.doints || 0,
            qoints: data.qoints || 0,
            boints: data.boints || 0,
            pendingQoints: data.pendingQoints || 0,
            assets: data.assets || []
        };
    }

    async rareCandy(userId, exp) {
        return this.updateOne(
            { userId },
            { exp }
        );
    }

    async writeUserData(userId, data) {
        const economyData = this.massageData(data);
        return this.updateOne(
            { userId },
            economyData,
        );
    }

    async writeQoints(userId, qoints) {
        return this.updateOne(
            { userId },
            { qoints }
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
        const economyData = this.massageData(data);
        return this.updateOne(
            { userId },
            economyData,
            { upsert: true }  // Only use upsert here for new users
        );
    }
}

module.exports = UserEconomyDB;