/**
 * @typedef {object} ToolDefinition
 * @property {string} toolId - system-unique, e.g., 'fluxgeneral'
 * @property {string} service - source of tool, e.g., 'comfyui', 'vidu'
 * @property {string} displayName - user-facing name
 * @property {string} [description] - a full agent-readable description of purpose, use, and behavior
 * @property {string} [commandName] - e.g., '/fluxgeneral' for Telegram
 * @property {string} [apiPath] - internal or external route, e.g., '/api/internal/run/fluxgeneral'
 * @property {string} [version] - semantic version (e.g., '1.0.0', '2.0.0') for tracking schema changes
 * @property {Object<string, MigrationDefinition>} [migrations] - migration definitions keyed by version
 * @property {Object<string, InputField>} inputSchema
 * @property {Object<string, any>} [outputSchema] // Simplified for now
 * @property {CostingModel} [costingModel]
 * @property {WebhookConfig} [webhookStrategy]
 * @property {PlatformHints} [platformHints]
 * @property {'text-to-image'|'img2img'|'upscale'|'inpaint'|'video'|'interrogate'} [category]
 * @property {Object<string, string>} [humanDefaults]
 * @property {'public'|'internal'|'hidden'} [visibility]
 * @property {Object<string, any>} [metadata] // For extra service-specific data
 * @property {'immediate'|'webhook'} deliveryMode // NEW: how results are delivered
 */

/**
 * @typedef {object} MigrationDefinition
 * @property {Object<string, string|ContextDependentMapping>} [parameters] - parameter rename mappings
 */

/**
 * @typedef {object} ContextDependentMapping
 * @property {string} default - default target parameter name
 * @property {object} [when] - conditional mapping
 * @property {string} when.field - field to check for condition
 * @property {string} when.value - value that triggers alternative mapping
 * @property {string} when.use - alternative target parameter name when condition is met
 */

/**
 * @typedef {object} InputField
 * @property {string} name
 * @property {'string'|'number'|'image'|'video'|'audio'|'file'|'boolean'} type
 * @property {boolean} required
 * @property {any} [default]
 * @property {string} [description]
 * @property {boolean} [advanced] // used to group parameters in UI
 */

/**
 * @typedef {object} CostingModel
 * @property {number} rate // e.g., 0.000337 USD per unit
 * @property {'second'|'token'|'request'} unit
 * @property {'static'|'machine'|'api'} rateSource
 */

/**
 * @typedef {object} WebhookConfig
 * @property {string} expectedStatusField
 * @property {string} successValue
 * @property {boolean} durationTracking
 * @property {string[]} [resultPath] // JSON path to output artifact (e.g., image URL)
 */

/**
 * @typedef {object} PlatformHints
 * @property {'text'|'image'|'video'|'audio'|'file'} primaryInput
 * @property {boolean} supportsFileCaption // e.g., Telegram: attach file, type in caption
 * @property {boolean} supportsReplyWithCommand
 */

// To make this a module and allow exports if needed, though JSDoc types are global.
// module.exports = {}; // Not strictly necessary if only defining types for JSDoc 