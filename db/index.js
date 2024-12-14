// Main export file that brings it all together
const { BaseDB } = require('./models/BaseDB');
const UserEconomyDB = require('./models/userEconomy');
const StatsDB = require('./models/userStats');
const UserPrefDB = require('./models/userPref');
const UserCoreDB = require('./models/userCore');
const FloorplanDB = require('./models/floorplan');
const LoraDB = require('./models/workspace');
const CollectionDB = require('./models/collection');
//const { watchCollection } = require('./mongoWatch');


module.exports = {
    UserEconomy: UserEconomyDB,
    UserStats: StatsDB,
    UserCore: UserCoreDB,
    UserPref: UserPrefDB,
    Workspace: LoraDB,
    BaseDB: BaseDB,
    FloorplanDB: FloorplanDB,
    CollectionDB: CollectionDB
};