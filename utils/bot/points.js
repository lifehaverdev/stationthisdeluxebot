const { lobby } = require('../bot/bot')
const { comfydeployment_ids } = require('../comfydeploy/deployment_ids')

function addPoints(promptObj) {
    const deployment = comfydeployment_ids.find(d => d.type === promptObj.type);
    
    if (deployment) {
        const user = lobby[promptObj.userId];
        
        if (user) {
            const pointsToAdd = deployment.score * promptObj.batchMax;
            user.points += pointsToAdd;
        } else {
            console.log(`User with ID ${promptObj.userId} not found in the lobby.`);
        }
    } else {
        console.log(`Deployment with type ${promptObj.type} not found.`);
    }
}

function checkPoints(userId) {
    
}

module.exports = { addPoints };