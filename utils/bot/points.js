const { lobby, globalStatus } = require('../bot/bot')
const { getGroup } = require('./handlers/iGroup');
const { FloorplanDB } = require('../../db/index');
const GlobalStatusDB = require('../../db/models/globalStatus');
const UserEconomyDB = require('../../db/models/userEconomy');
const collectionCook = require('./handlers/collectionmode/collectionCook');
const globalStatusData = new GlobalStatusDB();
const { NOCOINERSTARTER, POINTMULTI, checkIn } = require('./gatekeep')

const floorplanDB = new FloorplanDB();

// Helper function to get the user's max balance
function getMaxBalance(userObject) {
    const max = Math.floor((userObject.balance + NOCOINERSTARTER) / POINTMULTI)
    return max; // Adjust this as needed if balance calculations are more complex
}

// Helper function to update group points in DB
async function updateGroupPoints(group, pointsDeducted) {
    try {
        await floorplanDB.writeRoomData(group.chat.id, {
            qoints: group.qoints,
            burnedQoints: (group.burnedQoints || 0) + pointsDeducted
        });
    } catch (error) {
        console.error(`Failed to update group points in DB for group ${group.chat.id}:`, error);
        throw error; // Or handle as needed
    }
}

async function addPoints(task) {
    ({ promptObj, message } = task);
    const userId = promptObj.userId;
    const pointsToAdd = ((task.runningStop - task.runningStart) / 1000) * rate;
    

    // Special handling for cook mode - always use qoints
    // Special handling for cook mode - always use qoints
    if (promptObj.isCookMode) {
        // Check lobby first
        if (lobby[userId]?.qoints !== undefined) {
            console.log('Using lobby qoints for cook mode:', lobby[userId].qoints);
            lobby[userId].qoints = (lobby[userId].qoints || 0) - pointsToAdd;
            userQoints = lobby[userId].qoints;
        } else {
            // If not in lobby, work with DB
            const userEconomy = new UserEconomyDB();
            const userEco = await userEconomy.findOne({ userId });
            if (userEco) {
                userEco.qoints -= pointsToAdd;
                await userEco.save();
                userQoints = userEco.qoints;
                console.log('Using DB qoints for cook mode:', userQoints);
            } else {
                console.error('No user economy found for cook mode user:', userId);
                return;
            }
        }
        try {
            // Get fresh status from DB
            const status = await collectionCook.getCookingStatus();
            
            console.log('Points.js - Before mapping:', {
                cookingTasks: status.cooking?.length || 0,
                promptCollectionId: promptObj.collectionId
            });

            const updatedCooking = status.cooking.map(cook => {
                console.log('Points.js - Mapping cook:', {
                    cookCollectionId: cook.collectionId,
                    promptCollectionId: promptObj.collectionId,
                    isMatch: cook.collectionId === promptObj.collectionId
                });
                
                return cook.collectionId === promptObj.collectionId
                    ? { 
                        ...cook,
                        lastGenerated: Date.now(),
                        generationCount: (cook.generationCount || 0) + 1,
                        generationStatus: 'pending'
                    }
                    : cook;
            });

            await collectionCook.updateCookingStatus({ cooking: updatedCooking });
            // Call checkCookProgress to handle next generation
            
            try {
                await collectionCook.checkCookProgress(
                    task.promptObj.userId, 
                    task.promptObj.collectionId
                );
            } catch (error) {
                console.error('Error checking cook progress:', error);
            }
            
        } catch (error) {
            console.error(`Failed to update status for cooking task ${promptObj.collectionId}:`, error);
        }

        return; //Early return for cook mode
    } else {
        if (!lobby[userId]) {
            await checkIn(message);
            if (!lobby.hasOwnProperty(userId)) {
                console.error(`User ID ${userId} not found in lobby after check-in, unable to subtract doints.`);
                return;
            }
        }
    
        let rate = 2;
        const doublePointTypes = ['MS3.2']; // You can add more types here if needed
        if (doublePointTypes.includes(promptObj.type)) {
            rate = 6;
        }
        
        
        const user = lobby[userId];
        const group = getGroup(message);
        const max = getMaxBalance(user);
        const credit = user.points + user.doints;

        if (group) {
            // Handling based on group point accounting strategy
            if (group.gateKeeping.pointAccounting === 'house') {
                // House pays for all point addition/subtraction
                console.log(`Group ${group.id} point accounting is set to 'house'. Deducting ${pointsToAdd} points from group balance. Current group balance: ${group.qoints}`);
                group.qoints -= pointsToAdd;
                try {
                    await updateGroupPoints(group, pointsToAdd);
                } catch (error) {
                    console.error(`Failed to update house points for group ${group.id}:`, error);
                    // Consider adding fallback behavior
                }
            } else if (group.gateKeeping.pointAccounting === 'ghost') {
                // 'ghost' accounting - treat as if there is no group
                console.log(`Group ${group.id} point accounting is set to 'ghost'. Treating as if there's no group.`);
                
                // Simply add all points to user, without considering any group logic
                user.points += pointsToAdd;
            } else {
                // Default: User pays first, then group covers remaining
                if (credit < max) {
                    // User has room to add points, but we no longer cap it to max
                    const pointsToUser = Math.min(pointsToAdd, max - credit);
                    user.points += pointsToUser;
        
                    // The rest are charged to the group without limiting group qoints to zero
                    const pointsToGroup = pointsToAdd - pointsToUser;
                    if (pointsToGroup > 0) {
                        group.qoints -= pointsToGroup;
                        try {
                            await updateGroupPoints(group, pointsToGroup);
                        } catch (error) {
                            console.error(`Failed to update group points for group ${group.id}:`, error);
                            // Consider adding fallback behavior
                        }
                    }
                } else {
                    // User is already at or above max, so all points are covered by the group
                    group.qoints -= pointsToAdd;
                    try {
                        await updateGroupPoints(group, pointsToAdd);
                    } catch (error) {
                        console.error(`Failed to update group points for group ${group.id}:`, error);
                        // Consider adding fallback behavior
                    }
                }
            }
        } else {
            // No group: Handle user-only point logic
            if (user.qoints && credit > max) {
                // If user has qoints and is over max, subtract from qoints and add to boints
                user.qoints = Math.max(0, user.qoints - pointsToAdd);
                user.boints = (user.boints || 0) + pointsToAdd;
                console.log(`Points moved from qoints to boints for user ${user.id}. New qoints: ${user.qoints}, new boints: ${user.boints}`);
            } else {
                // Otherwise add points normally
                user.points += pointsToAdd;
                console.log(`Points added to user ${user.id}. New total: ${user.points}`);
            }
        }
    }
    

    // Always remove placeholder doints
    const beforeSub = user.doints;
    user.doints = (Number(user.doints)) - (Number(promptObj.dointsAdded) || 100);
    const afterSub = user.doints;
    if (beforeSub - afterSub != promptObj.dointsAdded) {
        console.log('its still broken arth');
    }
}

module.exports = { addPoints };