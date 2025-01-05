const { BaseDB } = require('./BaseDB');

class UserStats extends BaseDB {
    constructor() {
        super('gens');
    }

    async saveGen({ task, run, out }) {
        const genData = {
            userId: task.promptObj.userId,
            username: task.promptObj.username || 'unknown',
            groupId: task.message.chat.id || 'unknown',
            timestamp: new Date(),
            promptObj: task.promptObj,
            runId: run.run_id,
            outputs: out,
            status: run.status,
            duration: task.runningStop - task.runningStart,
            type: task.promptObj.type
        };

        return this.insertOne(genData);
    }
    

    // We can add methods for aggregating stats later:

    // async getUserGenerations(userId, limit = 100) { ... }
    // async getGroupGenerations(groupId, limit = 100) { ... }
    // async getGenerationStats(userId) { ... }
}

module.exports = UserStats;