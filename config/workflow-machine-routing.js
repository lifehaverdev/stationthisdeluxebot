/**
 * Machine Routing Configuration
 * 
 * Maps workflow names to specific machine IDs for optimal processing.
 * This configuration is used by the WorkflowsService for routing
 * workflow execution requests to appropriate machines.
 */

module.exports = {
  // Map workflow names to specific machine IDs
  routingRules: {
    // Text-to-Image workflows
    'text2img': '42dead75-c27c-486f-969c-0911f338a877', // StationthisHun
    
    // Inpainting workflows
    'inpaint': 'a254eea6-8d28-461f-9f6b-18c115c8d3e4', // inpainter
    
    // Special generation workflows
    'controlnet': '27989bf0-fa96-4053-ba05-4cccec88d185', // fluxdev
    'img2img': '27989bf0-fa96-4053-ba05-4cccec88d185',    // fluxdev
    
    // 3D generation workflows
    'img2vid': 'bdca4ae1-b11b-44ae-94ba-9f2c6d311d98',   // TRIPO
    'toon': 'bdca4ae1-b11b-44ae-94ba-9f2c6d311d98',      // TRIPO
    
    // Training workflows
    'lora_train': '42dead75-c27c-486f-969c-0911f338a877', // StationthisHun
    
    // Upscaling workflows
    'upscale': '27989bf0-fa96-4053-ba05-4cccec88d185'     // fluxdev
  },
  
  // Default machine if no specific rule exists
  defaultMachine: '42dead75-c27c-486f-969c-0911f338a877' // StationthisHun as default
}; 