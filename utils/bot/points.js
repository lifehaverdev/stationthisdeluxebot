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

    let rate = 3;
    const doublePointTypes = ['MS3.2']; // You can add more types here if needed
    if (doublePointTypes.includes(promptObj.type)) {
        rate = 6;
    }
    
    const pointsToAdd = ((task.runningStop - task.runningStart) / 1000) * rate;
    const user = lobby[userId];
    const group = getGroup(message);
    const max = getMaxBalance(user);
    const credit = user.points + user.doints;

    // Handling based on group point accounting strategy
    if (group && group.gateKeeping.pointAccounting === 'house') {
        // House pays for all point addition/subtraction
        console.log(`Group ${group.chatId} point accounting is set to 'house'. Deducting from group.`);
        group.qoints -= pointsToAdd;
        updateGroupPoints(group, pointsToAdd);
    } else {
        // User pays first until reaching max, then group covers remaining
        if (credit < max) {
            // User has room to add points up to their max
            const pointsToUser = Math.min(pointsToAdd, max - credit);
            user.points += pointsToUser;

            // If points exceed the user's max, the rest are charged to the group
            if (pointsToAdd > pointsToUser) {
                const pointsToGroup = pointsToAdd - pointsToUser;
                if (group && group.qoints > 0) {
                    group.qoints -= pointsToGroup;
                    updateGroupPoints(group, pointsToGroup);
                }
            }
        } else {
            // User is at max, so the group must cover the entire addition
            if (group && group.qoints > 0) {
                group.qoints -= pointsToAdd;
                updateGroupPoints(group, pointsToAdd);
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