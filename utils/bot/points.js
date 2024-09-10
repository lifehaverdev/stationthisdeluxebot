const { lobby } = require('../bot/bot')
const { getGroup } = require('./handlers/iGroup');
const { updateGroupPoints } = require('../../db/mongodb')

function addPoints(task) {
    ({ promptObj, message } = task);
    const pointsToAdd = (Date.now()-task.timestamp) / 1000;
    const user = lobby[promptObj.userId];
    const group = getGroup(message);
    //console.log('group',group)
    if((user && !group) || (user.verified && group)){
        if(user && group) console.log('WE ADDING POINTS TO USER EVEN THO GROUP')
        user.points += pointsToAdd;
    } else if (group){
        group.points += pointsToAdd;
        updateGroupPoints(group,pointsToAdd)
    } else {
        console.log('no user id in lobby for points addition after task completion')
    }
}


module.exports = { addPoints };