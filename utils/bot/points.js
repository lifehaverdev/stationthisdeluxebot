const { lobby } = require('../bot/bot')
//const { comfydeployment_ids } = require('../comfydeploy/deployment_ids')
const { getGroup } = require('./handlers/iGroup');
const { updateGroupPoints } = require('../../db/mongodb')

function addPoints({promptObj,task,message}) {
    const pointsToAdd = (Date.now()-task.timestamp) / 1000;
    const user = lobby[promptObj.userId];
    const group = getGroup(message);
    console.log('group',group)
    if(user && (group == -1 || group == '-1')){
        user.points += pointsToAdd;
    } else if (group){
        group.points += pointsToAdd;
        updateGroupPoints(group,pointsToAdd)
    } else {
        console.log('no user id in lobby for points addition after task completion')
    }
}


module.exports = { addPoints };