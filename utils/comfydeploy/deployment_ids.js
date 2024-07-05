const comfydeployment_ids = [
    {
        type: "MAKE",
        name: "make2",
        id: "4df24e30-1484-4ebe-8f87-0c68c43baa95",
        score: 37
    },
    {
        type: "MS2",
        name: "ms2_2",
        id: "89a840d9-bf46-4669-a444-93748e49b9df",
        score: 35
    },
    {
        type: "MS3",
        name: "img2vidzoll",
        id: "389013b2-a888-4521-8447-747f9b7c6a5e",
        score: 117
    },
    {
        type: "MS2_STYLE",
        name: "ms2_style",
        id: "4191863b-ebb3-4270-9e12-3dfb89cfd3a0",
        score: 63
    },
    {
        type: "MS2_CONTROL",
        name: "ms2_depth",
        id: "7dcb8a03-ef18-4bb2-990f-d2571779b458",
        score: 42
    },
    {
        type: "MS2_CONTROL_STYLE",
        name: "ms2_depth_style",
        id: "0644d2fd-2cb4-47cf-a7b9-b650559eb501",
        score: 62
    },
    {
        type: "MAKE_STYLE",
        name: "make_style",
        id: "cf8d81b7-20e8-456d-a349-48e0af4018e8",
        score: 52
    },
    {
        type: "MAKE_CONTROL_STYLE",
        name: "make_control_style",
        id: "935facb4-34b2-4cab-b96c-efdd43da2c6d",
        score: 65
    },
    {
        type: "MAKE_CONTROL",
        name: "make_control",
        id: "c8075e47-ad63-477e-a69d-56f55c88289e",
        score: 59
    },
    {
        type: "MAKE3",
        name: "make3",
        id: "75636593-5a88-4b85-b0e6-504cc500b3cb",
        score: 56
    },
    {
        type: "PFP",
        name: 'pfp',
        id: "0ea331d5-7006-4149-9dfe-cd82885f9188",
        score: 57
    },
    {
        type: "PFP_STYLE",
        name: 'pfp_style',
        id: 'ef9a6f6d-f833-45a2-a92a-ac25664a4dfd',
        score: 56
    },
    {
        type: "PFP_CONTROL",
        name: "pfp_control",
        id: '9ac6a0d1-6aff-4796-b25d-bd95cd9c30d3',
        score: 87
    },
    {
        type: "PFP_CONTROL_STYLE",
        name: 'pfp_control_style',
        id: 'd1863419-8f2a-4dbd-b80d-cec63a4803e4',
        score: 121
    },
    {
        type: "INTERROGATE",
        NAME: 'interrogate',
        id: '1be45f3d-1420-4018-843c-2af8cdb006d6',
        score: 46
    },
    {
        type: "ASSIST",
        NAME: 'assist',
        id: 'na',
        score: 10
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
    getDeploymentIdByType,
    comfydeployment_ids
};