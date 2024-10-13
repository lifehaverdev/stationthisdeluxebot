const { lobby } = require('../bot/bot')
const { getGroup } = require('./handlers/iGroup');
const { updateGroupPoints } = require('../../db/mongodb')

function addPoints(task) {
    ({ promptObj, message } = task);
    let rate = 1; 
    if(promptObj.type == 'MS3.2') {
        task.promptObj.rate = 2;
    }
    const pointsToAdd = ((task.runningStop-task.runningStart) / 1000) * rate;
    const user = lobby[promptObj.userId];
    const group = getGroup(message);
    //console.log('group',group)
    if((user && !group) || (user.verified && group)){
        //if(user && group) console.log('WE ADDING POINTS TO USER EVEN THO GROUP')
        user.points += pointsToAdd;
        user.doints -= promptObj.dointsAdded;
    } else if (group){
        group.points += pointsToAdd;
        updateGroupPoints(group,pointsToAdd)
    } else {
        console.log('no user id in lobby for points addition after task completion')
    }
}


module.exports = { addPoints };