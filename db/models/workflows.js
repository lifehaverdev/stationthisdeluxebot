const { BaseDB } = require('./BaseDB');

class WorkflowDB extends BaseDB {
    constructor() {
        super('workflow');
    }

    async getActiveFlows() {
        return this.findMany({ active: true });
    }
}

module.exports = WorkflowDB;