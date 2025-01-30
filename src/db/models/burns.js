const { BaseDB } = require('./BaseDB');

class BurnsDB extends BaseDB {
    constructor() {
        super('burns');
    }

    async getAllBurns() {
        return this.findMany();
    }
}

module.exports = BurnsDB;