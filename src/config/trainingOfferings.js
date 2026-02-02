/**
 * Training Offerings Registry
 * ---------------------------------
 * Central, runtime-loadable config that enumerates the types of trainings
 * we can provide. UI and job submission flows read from this file so that
 * adding a new offering is as simple as creating an entry here and
 * restarting the server.
 *
 * Each offering object:
 * {
 *   id: string,                      // unique key, reference in TrainingDB.offeringId
 *   name: string,                    // human readable
 *   baseModel: string,               // must align with toolBaseModel in LoraResolutionService (e.g. "SDXL", "FLUX", "WAN")
 *   description?: string,
 *   minImages: number,
 *   maxImages?: number,
 *   autoCaption: boolean,            // whether server auto-generates captions prior to training
 *   costPoints?: number,             // optional default price
 *   status: 'active'|'coming_soon',  // drives UI availability
 *   hyperParams?: object             // arbitrary config consumed by training worker
 * }
 */

const offerings = [
  {
    id: 'sdxl-lora',
    name: 'SDXL LoRA',
    baseModel: 'SDXL',
    description: 'Fine-tune a Stable Diffusion XL checkpoint via Low-Rank Adaptation. 20–40 pics, 8GB VRAM.',
    minImages: 20,
    maxImages: 40,
    autoCaption: true,
    costPoints: 86400,
    status: 'active',
    hyperParams: {
      epochs: 10,
      lr: 1e-4
    }
  },
  {
    id: 'flux-lora',
    name: 'Flux LoRA',
    baseModel: 'FLUX',
    description: 'LoRA training targeting Flux-series checkpoints (Flux, Flux.1, Flux1-D).',
    minImages: 20,
    autoCaption: true,
    costPoints: 86400,
    status: 'active',
    hyperParams: {
      epochs: 8,
      lr: 5e-5
    }
  },
  {
    id: 'wan-lora',
    name: 'WAN LoRA',
    baseModel: 'WAN',
    description: 'LoRA for WAN-based anime checkpoints.',
    minImages: 20,
    autoCaption: true,
    status: 'hidden' // Not yet trainable
  },
  {
    id: 'kontext-lora',
    name: 'Kontext LoRA',
    baseModel: 'KONTEXT',
    description: 'LoRA for FLUX Kontext - supports style/subject and concept training modes.',
    minImages: 15,
    autoCaption: true,
    costPoints: 120000,
    status: 'active',
    hyperParams: {
      steps: 3000,
      lr: 1e-4,
      loraRank: 16,
      loraAlpha: 16
    },
    trainingModes: ['style_subject', 'concept']
  }
];

/**
 * Utility: get offering by id
 */
function getOffering(id) {
  return offerings.find(o => o.id === id);
}

module.exports = {
  offerings,
  getOffering
};
