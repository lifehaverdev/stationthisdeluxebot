

const loraTriggers = [
  {
      lora_name: 'diffusion64-v2-merge',
      default_weight: 0.9,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/136354/diffusion64-sdxl',
      description: "A Stable Diffusion XL LoRA that generates Ocarina of Time / Majora's Mask style images. Training set is 1,500+ hand-tagged screenshots.",
      triggerWords: ["N64STYLE","N64","3D","OCARINAOFTIME","MAJORASMASK"]
  },
  {
      lora_name: 'wojak_SDXL',
      default_weight: 0.8,
      version: 'SDXL',
      type: 'character',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/128046?modelVersionId=140160',
      description: "This model was trained on over 14K wojak images with various tags. It should generate Wojaks for just about any character. There aren't many character LoRAs available, so I haven't had the chance to test it extensively with other LoRAs. I was hoping the different character styles would be more easy to generate (Trad Wife, Doomer, etc.) but I think there were too many standard Wojaks and it got more trained on that style. If there is enough interest, I will try doing a version 2 where I balance out the styles a little more, but this took 118 hours just on the training, so I'm not going to spend the time training another one if no one cares that much.",
      triggerWords: ["WOJAK","CRYING WOJACK","TRAD WIFE", "DOOMER"]
  },
  {
      lora_name: 'ponydiffusionv6_pepethefrog',
      default_weight: 0.9,
      version: 'SDXL',
      type: 'character',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/301368?modelVersionId=338451',
      description: `Because fuck you, that's why. Trigger is "pepe the frog", supporting tags are "frog, amphibian"`,
      triggerWords: ["pepe the frog","pepe"]
  },
  {
      lora_name: 'vanta-black_contrast_V3.0',
      default_weight: 0.8,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/321730?modelVersionId=360756',
      description: `Based on sdxl 1.0 model. Works well with realistic stock photo model or any other model. Please read version info.`,
      triggerWords: ["vantablack"]
  },
  {
    lora_name: 'CLAYMATE',
    default_weight: 1,
    version: 'SDXL',
    type: 'style',
    gate: 0,
    civitaiLink: 'https://civitai.com/models/208168/claymate-claymation-style-for-sdxl',
    description: 'claymation style',
    triggerWords: ['claymation']
  },
  {
      lora_name: 'RW_PS1v1',
      default_weight: 0.8,
      version: 'SD1.5',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/186443?modelVersionId=209344',
      description: `SD1.5`,
      triggerWords: ["PS1"]
  },
  {
      lora_name: 'LOW_POLY_PLAYSTATION_1_STILL',
      default_weight: 0.9,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/370957?modelVersionId=414432',
      description: `About: Trained on selected dataset with original resolution from psx esque. For Foocus, disable all styles and negatives ( you can also try noise and low quality at negative, but it will make look like upscaled. ) This lora was trained with low resolution, so some artifacts like multiple persons will happen. TO DO: A new version with fixed resolution and noises. ❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️Do and tips: 1 weight for generation / 1.2/1.5 weight for img2img`,
      triggerWords: ["low poly","playstation 1 still"]
  },
  {
      lora_name: 'asciiart',
      default_weight: 0.8,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/130190?modelVersionId=142815',
      description: 'its like ascii art from tron or some sh - arthurt',
      triggerWords: ["ascii art"]
  },
  {
      lora_name: 'GHIBLI_STYLE',
      default_weight: 0.8,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/359367/ghibli-style-xl',
      description: `Send thanks to Ghibli Studio for the publicly available dataset they released. My LoRA model was trained on this dataset with an image resolution of 1280x768. In the future, we will add more image resolutions and continue to improve the model's sharpness, all for the community. Please hit the follow button. Thank you.`,
      triggerWords: ["GHIBLI"]
  },
  {
      lora_name: 'HeavyMetalStyle-000009',
      default_weight: 1.2,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/179844?modelVersionId=201832',
      description: `Based on the popular animation style used in Heavy Metal. Might need to increase weight to 1.2 if using a realistic model. Also helps to use tags like flat art, or 2D flat art. My first attempt at this so be nice.`,
      triggerWords: ["HEAVYMETALSTYLE"]
  },
  {
      lora_name: 'y2kmadmix_v0.0.1',
      default_weight: 0.9,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/360281?modelVersionId=408488',
      description: `The model is made for creating weirdcore-like images. It was trained on a mix of weird images, that I associate with weirdcore, dreamcore, y2k aesthetics and other Y2K mad vibe stuff.`,
      triggerWords: ["Y2KMAD"]
  },
  {
      lora_name: 'Lego_XL_v2.1',
      default_weight: 0.8,
      version: 'SDXL',
      type: 'style',
      gate: 0,
      civitaiLink: 'https://civitai.com/models/92444?modelVersionId=318915',
      description: `LeLo stands for LEGO LoRA. It is a LoRA trained with over 900 images from the LEGO MiniFigures, BrickHeadz, and Creator themes. It provides a simulation of the LEGO design style.`,
      triggerWords: ["LEGO","MINIFIG","LEGO CREATOR","LEGO BRICKHEADZ"]
  },
  {
      lora_name: 'MOGGLES_MOGCAT_PIT_VIPERS',
      default_weight: 0.9,
      version: 'SDXL',
      type: 'character',
      gate: 0,
      civitaiLink: 'miladystation2.net',
      description: 'stationthisbot original lora for all the cousins xoxo - arthurt',
      triggerWords: ["MOGGLES", "MOGCAT", "PIT_VIPERS"]
  },
  {
    lora_name: 'joycat',
    default_weight: 1,
    version: 'SDXL',
    type: 'character',
    gate: 0,
    civitaiLink: 'mogcoin.xyz',
    description: 'mogcat v2 lora trained by mooncryptowow',
    triggerWords: ['joycat','😹']
  },
  {
    lora_name: 'mewing1',
    default_weight: 0.8,
    version: 'SDXL',
    type: 'character',
    gate: 0,
    civitaiLink: 'miladystation2.net',
    description: 'this mewing lora is for looksmaxxing',
    triggerWords: ['mewing']
  },
  {
    lora_name: '13angel332',
    default_weight: 1,
    version: 'SDXL',
    type: 'style',
    gate: 0,
    civitaiLink: 'miladystation2.net',
    description: 'angel lora for infinite love and prayer',
    triggerWords: ['13angel33']
  },
  {
    lora_name: 'petravoice3',
    default_weight: 1,
    version: 'SDXL',
    type: 'style',
    gate: 0,
    civitaiLink: 'miladystation2.net',
    description: 'petravoice babes ai art',
    triggerWords: ['petravoice']
  },
  {
    lora_name: 'remilia',
    default_weight: 1,
    version: 'SDXL',
    type: 'character',
    featured: true,
    gate: 1000000,
    civitaiLink: 'miladystation2.net',
    description: 'cult is short for culture',
    triggerWords: ['remilia']
  }
  // Add more LoRA configurations here
  // {
  //     lora_name: ,
  //     default_weight: ,
  //     civitaiLink: ,
  //     description: ,
  //     triggerWords: [""]
  // }
];

function handleLoraTrigger(prompt, balance) {
  let usedLoras = new Set();
  let modifiedPrompt = prompt;

  loraTriggers.forEach(lora => {
    lora.triggerWords.forEach(triggerWord => {
      const regex = new RegExp(`${triggerWord}(\\d*)`, 'gi');
      modifiedPrompt = modifiedPrompt.replace(regex, (match, p1) => {
        const weight = p1 ? (parseInt(p1, 10) / 10).toFixed(1) : lora.default_weight;
        if (!usedLoras.has(lora.lora_name) && (lora.gate < balance)) {
          usedLoras.add(lora.lora_name);
          return `<lora:${lora.lora_name}:${weight}> ${triggerWord}`;
        } else {
          return triggerWord; // Avoid adding the LoRA syntax again if it's already used
        }
      });
    });
  });
  console.log('before after', prompt, modifiedPrompt)
  return modifiedPrompt;
}

// Testing the function with an example prompt
// const testPrompt = 'mogcat, MOGGLES wearing_sunglasses, furry, tuxedo, opulent mansion, yellow_cat, furry{{wojak15}:{[[Sonic the hedgehog]]}:0.5}s';
// const modifiedPrompt = handleLoraTrigger(testPrompt);
// console.log('Modified Prompt:', modifiedPrompt);

module.exports = {
  handleLoraTrigger, 
  loraTriggers
};