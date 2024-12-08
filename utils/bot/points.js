const { lobby } = require('../bot/bot')
const { getGroup } = require('./handlers/iGroup');
const { updateGroupPoints } = require('../../db/mongodb')
const { NOCOINERSTARTER, POINTMULTI, checkIn } = require('./gatekeep')

// Helper function to get the user's max balance
function getMaxBalance(userObject) {
    const max = Math.floor((userObject.balance + NOCOINERSTARTER) / POINTMULTI)
    return max; // Adjust this as needed if balance calculations are more complex
}

async function addPoints(task) {
    ({ promptObj, message } = task);
    const userId = promptObj.userId;
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
    
    const pointsToAdd = ((task.runningStop - task.runningStart) / 1000) * rate;
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
                console.error(`Failed to update group points for group ${group.id}:`, error);
                // Continue execution even if group points update fails
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
                        // Continue execution even if group points update fails
                    }
                }
            } else {
                // User is already at or above max, so all points are covered by the group
                group.qoints -= pointsToAdd;
                try {
                    await updateGroupPoints(group, pointsToAdd);
                } catch (error) {
                    console.error(`Failed to update group points for group ${group.id}:`, error);
                    // Continue execution even if group points update fails
                }
            }
        }
    } else {
        // No group: Handle user-only point logic
        user.points += pointsToAdd; // Add all points to the user without a max cap
        console.log(`Points added to user ${user.id}. New total: ${user.points}`);
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