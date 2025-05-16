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
        const economyData = this.massageData(data);
        return this.updateOne(
            { userId },
            economyData,
            { upsert: true }  // Only use upsert here for new users
        );
    }
}

module.exports = UserEconomyDB;