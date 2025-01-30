const { BaseDB } = require('./BaseDB');

class WorkflowDB extends BaseDB {
    constructor() {
        super('workflows');
    }

    async getActiveFlows() {
        return this.findMany({ active: true });
    }
}

module.exports = WorkflowDB;