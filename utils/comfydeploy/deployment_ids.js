const { flows } = require('../bot/bot')

function getDeploymentIdByType(type) {
    //console.log(flows)
    const workflow = flows.find(flow => flow.name === type);
    if (workflow) {
        const ids = workflow.ids;
        const inputs = workflow.inputs
        return { ids, inputs } ; //arrays
    } else {
        throw new Error(`Deployment ID not found for type: ${type}`);
    }
}

module.exports = {
    getDeploymentIdByType,
};