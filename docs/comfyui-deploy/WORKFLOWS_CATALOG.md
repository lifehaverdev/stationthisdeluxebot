# ComfyUI Deploy Workflows Catalog

## Overview
This document catalogs the available workflows from the ComfyUI Deploy API service. This serves as a reference for workflow naming, deployment IDs, and required inputs.

## Workflows

Due to current API connectivity issues, the full catalog is being assembled as workflows are discovered through testing. The following workflows have been identified:

### Text-to-Image (text2img)
**Display name**: Text to Image
**Workflow name**: text2img
**Deployment IDs**: [To be populated]
**Required inputs**:
- prompt
- negative_prompt (optional)
- width (optional, default: 512)
- height (optional, default: 512)
- guidance_scale (optional, default: 7.5)
- steps (optional, default: 20)
**Description**: Generates an image based on a text prompt

### Inpainting
**Display name**: Inpainting
**Workflow name**: inpaint
**Deployment IDs**: [To be populated]
**Required inputs**:
- prompt
- negative_prompt (optional)
- image
- mask
- guidance_scale (optional)
- steps (optional)
**Description**: Fills in masked areas of an image based on a text prompt

### ControlNet
**Display name**: ControlNet Image Generation
**Workflow name**: controlnet
**Deployment IDs**: [To be populated]
**Required inputs**:
- prompt
- negative_prompt (optional)
- control_image
- control_type (canny, depth, pose, etc.)
**Description**: Generates an image guided by a control image

## Machine Status

Based on the API response, the following machines are available:
- StationthisHun (ID: 42dead75-c27c-486f-969c-0911f338a877)
- TRIPO (ID: bdca4ae1-b11b-44ae-94ba-9f2c6d311d98)
- fluxdev (ID: 27989bf0-fa96-4053-ba05-4cccec88d185)
- inpainter (ID: a254eea6-8d28-461f-9f6b-18c115c8d3e4)

## Note
This catalog will be continuously updated as more workflows are discovered and tested through the API integration. 