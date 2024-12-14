const { BaseDB } = require('./BaseDB');

class LoraDB extends BaseDB {
    constructor() {
        super('loralist');
    }

    async getActiveLoras() {
        return this.findMany({ active: true });
    }
}

module.exports = LoraDB;