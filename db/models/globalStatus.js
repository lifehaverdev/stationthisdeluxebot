const { globalStatus } = require('../../utils/bot/bot');
const { BaseDB } = require('./BaseDB');
const { UserEconomy } = require('../../db');

class GlobalStatusDB extends BaseDB {
    constructor() {
        super('global_status');
        this.usersEconomyDB = new UserEconomy();
    }

    // Fetch all current status information
    async getGlobalStatus() {
        return this.monitorOperation(async () => {
            const status = await this.findOne({ type: 'globalStatus' }) || {
                training: [],
                cooking: [],
                chargePurchases: [],
                updatedAt: new Date()
            };
            return status;
        }, 'getGlobalStatus');
    }

    // Update specific status arrays - modified to work with existing updateOne
    async updateStatus(updates, shouldRefresh = false) {
        return this.monitorOperation(async () => {
            //console.log('[GlobalStatusDB] Starting updateStatus with:', updates);
            
            const currentStatus = await this.getGlobalStatus();
            //console.log('[GlobalStatusDB] Current status from DB:', currentStatus);
            
            const newStatus = {
                ...currentStatus,
                ...updates,
                updatedAt: new Date()
            };
            //console.log('[GlobalStatusDB] New status to save:', newStatus);
            
            const result = await this.updateOne(
                { type: 'globalStatus' },
                newStatus,
                { upsert: true }
            );
            
            //console.log('[GlobalStatusDB] Update result:', result);

            // Immediately refresh the in-memory globalStatus
            // If necessary 
            if (shouldRefresh) {
                await this.refreshGlobalStatus(globalStatus);
            }
            
            return result;
        }, 'updateStatus');
    }

    // Process pending charge purchases
    async processChargePurchases() {
        return this.monitorOperation(async () => {
            const status = await this.getGlobalStatus();
            const pendingCharges = status.chargePurchases.filter(charge => charge.status === 'pending');
            
            for (const charge of pendingCharges) {
                try {
                    // Find user by userId instead of wallet
                    console.log('charge we found', charge);
                    const userEconomy = await this.usersEconomyDB.findOne({ userId: charge.userId });
                    console.log('userEconomy we found', userEconomy);
                    
                    if (userEconomy) {
                        // Update user's pending qoints - using the raw update approach
                        const updatedUserEconomy = {
                            ...userEconomy,
                            pendingQoints: (userEconomy.pendingQoints || 0) + charge.pendingQoints,
                            lastUpdated: new Date()
                        };
                        
                        await this.usersEconomyDB.updateOne(
                            { userId: charge.userId },
                            updatedUserEconomy
                        );

                        // Update the charge status in the array
                        const updatedCharges = status.chargePurchases.map(c => 
                            c.id === charge.id 
                                ? { ...c, status: 'processed', processedAt: new Date() }
                                : c
                        );

                        await this.updateStatus({ chargePurchases: updatedCharges });
                        console.log(`Processed charge ${charge.id} for user ${charge.userId}`);
                    } else {
                        console.log(`No user economy found for user ${charge.userId}`);
                    }
                } catch (error) {
                    console.error(`Error processing charge ${charge.id}:`, error);
                    const updatedCharges = status.chargePurchases.map(c => 
                        c.id === charge.id 
                            ? { 
                                ...c, 
                                status: 'failed',
                                error: error.message,
                                failedAt: new Date()
                            }
                            : c
                    );
                    await this.updateStatus({ chargePurchases: updatedCharges });
                }
            }
        }, 'processChargePurchases');
    }

    // Refresh global status from database and process charges
    async refreshGlobalStatus(globalStatusObj) {
        const status = await this.getGlobalStatus();
        // Only update cooking array if it's empty in memory
        // This prevents overwriting active cooking tasks
        if (!globalStatusObj.cooking || globalStatusObj.cooking.length === 0) {
            globalStatusObj.cooking = status.cooking || [];
        }
        globalStatusObj.training = status.training || [];
        
        // Charge purchases should be merged not overwritten
        // to prevent losing recent transactions
        globalStatusObj.chargePurchases = [
            ...(globalStatusObj.chargePurchases || []),
            ...(status.chargePurchases || [])
        ].filter((purchase, index, self) => 
            index === self.findIndex(p => p.id === purchase.id)
        );
        
        // Process any pending charges
        await this.processChargePurchases();
        
        return status;
    }

    
}

module.exports = GlobalStatusDB;