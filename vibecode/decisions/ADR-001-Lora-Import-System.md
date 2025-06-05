# ADR-001: LoRA Import System from Civitai and Hugging Face

## Context
Users require a method to import LoRA (Low-Rank Adaptation) models from popular external repositories, specifically Civitai and Hugging Face, into the StationThis Deluxe Bot ecosystem. This will allow for an expanded and user-driven selection of models for image generation.

The system must:
- Provide a user-friendly interface within Telegram for submitting LoRA URLs.
- Support models compatible with FLUX (FLUX1-dev, FLUX-schnell), SDXL, SD3, and SD1.5 base model types.
- Extract relevant metadata (name, trigger words, base model, description, preview images) from the provided URLs.
- Integrate with the existing `LoRAModelsDB` for storing model information.
- Delineate imported models clearly by marking their origin (Civitai or Hugging Face) and original URL.
- Interface with the `comfyui-deploy` service/API to make the LoRA model available for generation.
- Ensure imported models are set to `visibility: 'public'` and `permissionType: 'public'`.

## Decision

The LoRA Import System will be implemented with the following components:

1.  **Telegram User Interface & Workflow:**
    *   The existing "Import LoRA" button in the LoRA menu (callback: `lora:request_form`) will trigger the import process.
    *   Upon callback activation, the bot will send a message to the user instructing them to reply with the direct URL to the LoRA model page on Civitai or Hugging Face. The message will also reiterate the supported base model types (FLUX, SDXL, SD3, SD1.5).
    *   A dedicated message reply listener will be implemented in `bot.js` to capture replies to this specific instruction message. This listener will identify the context (LoRA import URL submission) and extract the URL.

2.  **Information Extraction Service:**
    *   A new utility module (e.g., `src/utils/loraImportService.js`) will be created to handle metadata extraction.
    *   **Civitai:**
        *   Extract the model ID from the user-provided Civitai URL (e.g., `civitai.com/models/<model_id>/...`).
        *   Utilize the official Civitai API (e.g., `https://civitai.com/api/v1/models/<model_id>`) to fetch structured metadata.
    *   **Hugging Face:**
        *   Extract the model repository ID (e.g., `username/model_name`) from the URL.
        *   Utilize the Hugging Face Hub API (e.g., fetching `README.md`, `config.json`, or other metadata files within the repository) to gather model information. Specifics will depend on common LoRA storage patterns on Hugging Face.
    *   The service will attempt to map extracted data to the `LoRAModelsDB` schema fields (name, triggerWords, baseModel (checkpoint), description, previewImages).
    *   If essential information like base model type cannot be determined or is unsupported, the import will be rejected.

3.  **Internal API Endpoint for Import:**
    *   A new internal API endpoint will be created (e.g., `POST /internal/v1/loras/import-from-url`).
    *   **Inputs:** `loraUrl` (string), `masterAccountId` (string, for tracking who initiated the import).
    *   **Process:**
        1.  Validate the URL format and determine the source (Civitai/Hugging Face).
        2.  Call the `loraImportService` to extract metadata.
        3.  Validate that the extracted base model is one of the supported types.
        4.  Call a new method in `LoRAModelsDB` (e.g., `createImportedLoRAModel`) to save the model. This method will populate standard fields and specifically set:
            *   `importedFrom: { source: 'civitai'/'huggingface', url: loraUrl, originalAuthor: extractedAuthor, importedAt: new Date() }`
            *   `visibility: 'public'`
            *   `permissionType: 'public'`
            *   `ownedBy`: A system account ID or the importing user's ID (to be decided, implications for management). For simplicity, initially, it might not be tied to a user owner or could be a generic system owner.
            *   `createdBy`: The `masterAccountId` of the user who initiated the import.
        5.  Interface with the `comfyui-deploy` API to trigger the download and registration of the LoRA model file into the ComfyUI environment. This requires identifying the actual model file URL from the extracted metadata and passing it to `comfyui-deploy`. The specifics of the `comfyui-deploy` API need to be confirmed (e.g., endpoint, payload for adding a model from URL).
        6.  Return a success/failure response.

4.  **Bot Feedback:**
    *   After the internal API call, the bot will inform the user whether the import process was successfully initiated or if it failed (providing a reason, e.g., "Unsupported model type," "Could not retrieve metadata," "Deployment failed").

## Consequences

*   **Benefits:**
    *   Significantly expands the variety of LoRA models available to users.
    *   Empowers users to customize the model library.
    *   Automates a previously manual process.
*   **Drawbacks & Challenges:**
    *   Increased dependency on the availability and stability of Civitai and Hugging Face APIs and website structures.
    *   Metadata extraction can be complex and fragile due to inconsistencies in how model authors provide information.
    *   Requires robust error handling for URL parsing, API interactions, model file downloads, and deployment errors.
    *   Potential for users to submit URLs that are not LoRAs, are for unsupported games/versions, or are malicious. Validation will be key.
    *   The `comfyui-deploy` API integration details need to be clearly defined and implemented.
    *   Management of duplicate LoRA imports (e.g., if multiple users import the same model) will need consideration for future enhancements (e.g., checking by source URL or model ID).
    *   Security implications of downloading and deploying arbitrary model files from the internet need careful consideration and sandboxing if possible.

## Alternatives Considered

1.  **Manual Admin-Only Import:**
    *   Admins manually add LoRAs.
    *   *Rejected because:* Not scalable, slow, and doesn't empower users.
2.  **HTML Scraping instead of APIs:**
    *   Parse webpage HTML for metadata.
    *   *Rejected because:* Highly fragile and prone to break with website updates. APIs are preferred for stability.
3.  **Supporting Only One Platform (e.g., Civitai only):**
    *   Simplify initial implementation by focusing on a single source.
    *   *Rejected because:* Limits user choice and future expansion. Better to design for multiple sources from the outset, even if implemented sequentially.

---
*This ADR outlines the initial plan. Details, especially regarding the `comfyui-deploy` API and precise Hugging Face metadata strategies, will be refined during implementation.* 