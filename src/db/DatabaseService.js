console.log('initializing database service')
const { AnalyticsEvents } = require('./models/analyticsEvents');
const BurnsDB = require('./models/burns');
const CollectionDB = require('./models/collection');
const FloorplanDB = require('./models/floorplan');
const UserCoreDB = require('./models/userCore');
const UserEconomyDB = require('./models/userEconomy');
const UserStats = require('./models/userStats');
const UserPrefDB = require('./models/userPref');
const { Loras } = require('./models/loras');
const StudioDB = require('./models/studio');
const WorkflowDB = require('./models/workflows');
const LoraDB = require('./models/workspace');
console.log('database service models loaded')
class DatabaseService {
    constructor() {
        if (DatabaseService.instance) {
            return DatabaseService.instance;
        }
        
        console.log('Initializing DatabaseService...');
        
        // Initialize all DB instances
        this.analytics = new AnalyticsEvents();
        this.burns = new BurnsDB();
        this.collection = new CollectionDB();
        this.floorplan = new FloorplanDB();
        this.userCore = new UserCoreDB();
        this.userEconomy = new UserEconomyDB();
        this.userStats = new UserStats();
        this.userPref = new UserPrefDB();
        this.loras = new Loras();
        this.studio = new StudioDB();
        this.workflow = new WorkflowDB();
        this.trains = new LoraDB();

        console.log('DatabaseService initialized');
        DatabaseService.instance = this;
    }

    static getInstance() {
        return new DatabaseService();
    }
}

module.exports = DatabaseService;