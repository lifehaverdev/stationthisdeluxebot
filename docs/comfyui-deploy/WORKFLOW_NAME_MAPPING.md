# Workflow Name Mapping

## Overview
This document maps the workflow names between the ComfyUI Deploy API and the previously used database-sourced workflows, establishing standardized names to be used across the application.

## Mapping Table

| API Workflow Name | Database Workflow Name | Standardized Name | Notes |
|-------------------|------------------------|------------------|-------|
| text2img | makeImage | text2img | Standard text-to-image generation workflow |
| inpaint | inpaint | inpaint | Inpainting workflow for modifying specific parts of an image |
| controlnet | controlnet | controlnet | ControlNet-based generation with guidance images |
| img2img | img2img | img2img | Image-to-image transformation workflow |
| upscale | upscale | upscale | Image upscaling workflow |
| lora_train | train | lora_train | Workflow for training LoRA models |
| toon | tooncraft | toon | Specialized workflow for cartoon-style image generation |
| img2vid | video | img2vid | Image to video generation workflow |

## Implementation Notes

1. When retrieving workflows by name, the system should:
   - Accept any of the naming variants (API name, DB name, or standardized name)
   - Always convert to the standardized name internally
   - Use standardized names for logging and user-facing displays

2. Backward Compatibility:
   - The database naming will continue to be supported during the transition
   - Logs should include both names to assist with debugging

3. User Interface:
   - Display names should be user-friendly versions of the standardized names (e.g., "Text to Image" for "text2img")
   - Command shortcuts should align with standardized names

## Migration Strategy

1. Update all new code to use the standardized naming scheme
2. Add name normalization to the workflow service interface
3. Gradually update existing code to use the standardized names
4. Update user-facing documentation to reflect the standardized naming 