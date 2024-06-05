const comfydeployment_ids = [
    {
        type: "MAKE",
        name: "make2",
        id: "4df24e30-1484-4ebe-8f87-0c68c43baa95"
    },
    {
        type: "MS2",
        name: "ms2_2",
        id: "89a840d9-bf46-4669-a444-93748e49b9df"
    },
    {
        type: "MS3",
        name: "img2vidzoll",
        id: "389013b2-a888-4521-8447-747f9b7c6a5e"
    },
    {
        type: "MS2_CONTROL",
        name: "ms2_depth",
        id: "7dcb8a03-ef18-4bb2-990f-d2571779b458"
    },
    {
        type: "MS2_CONTROL_STYLE",
        name: "ms2_depth_style",
        id: "0644d2fd-2cb4-47cf-a7b9-b650559eb501"
    },
    {
        type: "MAKE_STYLE",
        name: "make_style",
        id: "cf8d81b7-20e8-456d-a349-48e0af4018e8"
    }
]
function getDeploymentIdByType(type) {
    const deployment = comfydeployment_ids.find(deployment => deployment.type === type);
    if (deployment) {
        return deployment.id;
    } else {
        throw new Error(`Deployment ID not found for type: ${type}`);
    }
}

module.exports = {
    getDeploymentIdByType
};