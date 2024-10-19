const { lobby } = require('../bot/bot')
const { getGroup } = require('./handlers/iGroup');
const { updateGroupPoints } = require('../../db/mongodb')
const { NOCOINERSTARTER, POINTMULTI } = require('./gatekeep')

// Helper function to get the user's max balance
function getMaxBalance(userObject) {
    const max = Math.floor((userObject.balance + NOCOINERSTARTER) / POINTMULTI)
    return max; // Adjust this as needed if balance calculations are more complex
}

function addPoints(task) {
    ({ promptObj, message } = task);
    let rate = 1; 
    // if(promptObj.type == 'MS3.2') {
    //     task.promptObj.rate = 2;
    // }
    const doublePointTypes = ['MS3.2','FLUX','MILADY','RADBRO','CHUD','DEGOD','MOG']
    if (doublePointTypes.includes(promptObj.type)) {
        task.promptObj.rate = 2;
    }
    const pointsToAdd = ((task.runningStop-task.runningStart) / 1000) * rate;
    const user = lobby[promptObj.userId];
    const group = getGroup(message);
    const max = getMaxBalance(user)
    const credit = user.points + user.doints

    if((user && !group) || (user.verified && group && credit < max)){        
        
        //somehow need to subtract from qoints however much is over max
         //IF credit already == max, qoints are subtracted
         //whateer qoints are subtracted , the same amount are added to boints
        if(credit >= max){
            //console.log('doing qoint work thankfully')
            user.qoints -= pointsToAdd;
            user.boints += pointsToAdd;
        //IF pointsToAdd exceeds the difference remaining between max and credit, the points are added until credit == max, then the rest are subtracted from qoints if they are there
        } else if(pointsToAdd > max - credit && qoints > 0){
            //console.log('we gon add a little to qoint a little to point')
            user.points += max - credit;
            pointsToAdd -= max - credit;
            user.qoints -= pointsToAdd;
            user.boints += pointsToAdd;
        //IF pointsToAdd + credit doesnt exceed max, just add points
        } else if (credit < max) {
            //console.log('classic points addition')
            user.points += pointsToAdd;
        } else {
            user.points += pointsToAdd;
        }
        
        //always remove the placeholder doints
        //console.log('made it to doints praise be')
        user.doints -= promptObj.dointsAdded;
    } else if (group){
        group.qoints -= pointsToAdd;
        updateGroupPoints(group,pointsToAdd)
    } else {
        console.log('no user id in lobby for points addition after task completion')
    }
}


module.exports = { addPoints };