const { flows } = require('../bot/bot')

function getDeploymentIdByType(type) {
    //console.log(flows)
    const workflow = flows.find(flow => flow.name === type);
    if (workflow) {
        console.log('found workflow by name',workflow)
        return workflow.ids; //an array
    } else {
        throw new Error(`Deployment ID not found for type: ${type}`);
    }
}

module.exports = {
    getDeploymentIdByType,
};