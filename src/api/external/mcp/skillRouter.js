/**
 * AI Skill Router
 *
 * Serves Claude skill documentation and OpenAPI specs for Codex/ChatGPT.
 * Makes NOEMA discoverable by various AI agent systems.
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { filterToolsForMcp } = require('./toolTransformer');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('SkillRouter');

// Path to skill documentation files
const SKILL_DOCS_PATH = path.join(__dirname, '../../../../docs/agent_usability/claude-skill');

/**
 * Creates the skill router
 * @param {Object} dependencies - Router dependencies
 * @returns {express.Router}
 */
function createSkillRouter(dependencies) {
  const { toolRegistry, loraService } = dependencies;
  const router = express.Router();

  /**
   * GET /.well-known/ai-skill.md
   * Main Claude skill file
   */
  router.get('/ai-skill.md', async (req, res) => {
    try {
      const content = await fs.readFile(path.join(SKILL_DOCS_PATH, 'Skill.md'), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
      logger.debug('[SkillRouter] Served ai-skill.md');
    } catch (error) {
      logger.error('[SkillRouter] Error serving skill:', error);
      res.status(404).send('Skill file not found');
    }
  });

  /**
   * GET /.well-known/ai-skill/api-reference.md
   */
  router.get('/ai-skill/api-reference.md', async (req, res) => {
    try {
      const content = await fs.readFile(path.join(SKILL_DOCS_PATH, 'API-REFERENCE.md'), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
    } catch (error) {
      res.status(404).send('File not found');
    }
  });

  /**
   * GET /.well-known/ai-skill/tools.md
   */
  router.get('/ai-skill/tools.md', async (req, res) => {
    try {
      const content = await fs.readFile(path.join(SKILL_DOCS_PATH, 'TOOLS.md'), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
    } catch (error) {
      res.status(404).send('File not found');
    }
  });

  /**
   * GET /.well-known/ai-skill/trigger-words.md
   */
  router.get('/ai-skill/trigger-words.md', async (req, res) => {
    try {
      const content = await fs.readFile(path.join(SKILL_DOCS_PATH, 'TRIGGER-WORDS.md'), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
    } catch (error) {
      res.status(404).send('File not found');
    }
  });

  /**
   * GET /.well-known/openai-skill.md
   * Alias for Claude skill - same content, for OpenAI Custom GPTs
   */
  router.get('/openai-skill.md', async (req, res) => {
    try {
      const content = await fs.readFile(path.join(SKILL_DOCS_PATH, 'Skill.md'), 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(content);
      logger.debug('[SkillRouter] Served openai-skill.md (alias)');
    } catch (error) {
      res.status(404).send('Skill file not found');
    }
  });

  /**
   * GET /.well-known/ai-plugin.json
   * OpenAI plugin manifest for ChatGPT/Codex
   */
  router.get('/ai-plugin.json', async (req, res) => {
    const plugin = {
      schema_version: 'v1',
      name_for_human: 'NOEMA AI Generation',
      name_for_model: 'noema',
      description_for_human: 'Generate AI images, videos, and media with 27+ tools and 214+ style models.',
      description_for_model: 'NOEMA is an AI generation platform. Use it to generate images (DALL-E, FLUX, Stable Diffusion), videos (LTX Video), and apply artistic styles using LoRA models. Discovery endpoints are public. Generation requires X-API-Key header. Always search for relevant LoRA trigger words before generating styled images.',
      auth: {
        type: 'user_http',
        authorization_type: 'custom',
        custom_auth_header: 'X-API-Key'
      },
      api: {
        type: 'openapi',
        url: 'https://noema.art/.well-known/openapi.json'
      },
      logo_url: 'https://noema.art/images/noema-logo.png',
      contact_email: 'support@noema.art',
      legal_info_url: 'https://noema.art/terms',
      instructions_url: 'https://noema.art/.well-known/openai-skill.md'
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(plugin);
    logger.debug('[SkillRouter] Served ai-plugin.json');
  });

  /**
   * GET /.well-known/openapi.json
   * OpenAPI 3.0 spec generated from toolRegistry
   */
  router.get('/openapi.json', async (req, res) => {
    try {
      const spec = await generateOpenApiSpec(toolRegistry, loraService);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(spec);
      logger.debug('[SkillRouter] Served openapi.json');
    } catch (error) {
      logger.error('[SkillRouter] Error generating OpenAPI spec:', error);
      res.status(500).json({ error: 'Failed to generate OpenAPI spec' });
    }
  });

  logger.info('[SkillRouter] Router initialized');
  return router;
}

/**
 * Generate OpenAPI 3.0 spec from toolRegistry
 */
async function generateOpenApiSpec(toolRegistry, loraService) {
  const allTools = toolRegistry ? toolRegistry.getAllTools() : [];
  const publicTools = filterToolsForMcp(allTools);

  // Get LoRA count for description
  let loraCount = 0;
  try {
    if (loraService) {
      const result = await loraService.listLoras({ limit: 1, page: 1 });
      loraCount = result.pagination?.totalLoras || 0;
    }
  } catch (e) {
    // Ignore
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'NOEMA AI Generation API',
      description: `NOEMA is an AI generation platform with ${publicTools.length} generation tools and ${loraCount}+ LoRA style models. Generate images (DALL-E, FLUX, Stable Diffusion), videos (LTX Video), apply artistic styles with LoRA triggers. Execute reusable Spell workflows, manage batch Collections, and train custom LoRA models.`,
      version: '1.0.0',
      contact: {
        name: 'NOEMA Support',
        url: 'https://noema.art',
        email: 'support@noema.art'
      }
    },
    servers: [
      {
        url: 'https://noema.art',
        description: 'Production server'
      }
    ],
    paths: {
      '/api/v1/tools/registry': {
        get: {
          operationId: 'listTools',
          summary: 'List all generation tools',
          description: 'Returns all available generation tools with their parameters and pricing.',
          tags: ['Discovery'],
          responses: {
            '200': {
              description: 'List of tools',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Tool' }
                  }
                }
              }
            }
          }
        }
      },
      '/api/v1/loras/list': {
        get: {
          operationId: 'listLoras',
          summary: 'List and search LoRA models',
          description: 'Search for LoRA style models. Use trigger words from results in your prompts to apply styles.',
          tags: ['Discovery'],
          parameters: [
            {
              name: 'q',
              in: 'query',
              description: 'Search query (searches name, description, tags, trigger words)',
              schema: { type: 'string' }
            },
            {
              name: 'checkpoint',
              in: 'query',
              description: 'Filter by base model compatibility',
              schema: {
                type: 'string',
                enum: ['FLUX', 'SDXL', 'SD1.5', 'SD3', 'All']
              }
            },
            {
              name: 'filterType',
              in: 'query',
              description: 'Sort/filter mode',
              schema: {
                type: 'string',
                enum: ['popular', 'recent', 'favorites']
              }
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Results per page',
              schema: { type: 'integer', default: 20 }
            },
            {
              name: 'page',
              in: 'query',
              description: 'Page number',
              schema: { type: 'integer', default: 1 }
            }
          ],
          responses: {
            '200': {
              description: 'List of LoRAs',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LoraListResponse' }
                }
              }
            }
          }
        }
      },
      '/api/v1/generation/execute': {
        post: {
          operationId: 'executeGeneration',
          summary: 'Execute a generation',
          description: 'Run a generation tool. Also available at /api/v1/generation/cast for backward compatibility. Tool IDs are obtained from /api/v1/tools/registry or MCP tools/list. Include LoRA trigger words in the prompt to apply styles.',
          tags: ['Generation'],
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GenerationRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Generation started',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GenerationResponse' }
                }
              }
            },
            '401': {
              description: 'API key required',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' }
                }
              }
            },
            '402': {
              description: 'Insufficient credits',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' }
                }
              }
            }
          }
        }
      },
      '/api/v1/generation/cast': {
        post: {
          operationId: 'executeGenerationAlias',
          summary: 'Execute a generation (alias)',
          description: 'Alias for /api/v1/generation/execute. Provided for backward compatibility with documentation.',
          tags: ['Generation'],
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GenerationRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Generation started',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GenerationResponse' }
                }
              }
            }
          }
        }
      },
      '/api/v1/generation/status/{generationId}': {
        get: {
          operationId: 'getGenerationStatus',
          summary: 'Check generation status',
          description: 'Poll for generation completion. Returns result when status is "completed".',
          tags: ['Generation'],
          security: [{ apiKey: [] }],
          parameters: [
            {
              name: 'generationId',
              in: 'path',
              required: true,
              description: 'Generation ID from execute/cast response',
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Generation status',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GenerationStatus' }
                }
              }
            }
          }
        }
      },
      '/api/v1/points': {
        get: {
          operationId: 'getCredits',
          summary: 'Get credit balance',
          description: 'Check available credits (points) for generation. Also available at /api/v1/points/balance.',
          tags: ['User'],
          security: [{ apiKey: [] }],
          responses: {
            '200': {
              description: 'Credit balance',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreditBalance' }
                }
              }
            }
          }
        }
      },
      // Spells
      '/api/v1/spells/marketplace': {
        get: {
          operationId: 'listSpells',
          summary: 'List available spells',
          description: 'Browse public spells (reusable generation workflows) sorted by popularity.',
          tags: ['Spells'],
          responses: {
            '200': {
              description: 'List of spells',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SpellList' } } }
            }
          }
        }
      },
      '/api/v1/spells/registry/{spellId}': {
        get: {
          operationId: 'getSpell',
          summary: 'Get spell details',
          description: 'Get full spell definition including steps and parameters.',
          tags: ['Spells'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'spellId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': {
              description: 'Spell details',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Spell' } } }
            }
          }
        }
      },
      '/api/v1/spells/cast': {
        post: {
          operationId: 'castSpell',
          summary: 'Execute a spell',
          description: 'Run a spell workflow with parameters.',
          tags: ['Spells'],
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SpellCastRequest' } } }
          },
          responses: {
            '200': {
              description: 'Spell cast started',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SpellCastResponse' } } }
            }
          }
        }
      },
      '/api/v1/spells/casts/{castId}': {
        get: {
          operationId: 'getSpellStatus',
          summary: 'Check spell execution status',
          description: 'Poll for spell completion and get results.',
          tags: ['Spells'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'castId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': {
              description: 'Cast status',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SpellCastStatus' } } }
            }
          }
        }
      },
      // Collections
      '/api/v1/collections': {
        get: {
          operationId: 'listCollections',
          summary: 'List your collections',
          description: 'Get all collections (batch generation projects) for the authenticated user.',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          responses: {
            '200': {
              description: 'List of collections',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Collection' } } } }
            }
          }
        },
        post: {
          operationId: 'createCollection',
          summary: 'Create a collection',
          description: 'Create a new batch generation collection.',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectionCreate' } } }
          },
          responses: {
            '200': {
              description: 'Collection created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Collection' } } }
            }
          }
        }
      },
      '/api/v1/collections/{id}': {
        get: {
          operationId: 'getCollection',
          summary: 'Get collection details',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Collection details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Collection' } } } }
          }
        },
        put: {
          operationId: 'updateCollection',
          summary: 'Update collection',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CollectionCreate' } } } },
          responses: {
            '200': { description: 'Collection updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Collection' } } } }
          }
        },
        delete: {
          operationId: 'deleteCollection',
          summary: 'Delete collection',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Collection deleted' } }
        }
      },
      '/api/v1/collections/{id}/cook/start': {
        post: {
          operationId: 'startCook',
          summary: 'Start batch generation',
          description: 'Begin generating pieces for this collection.',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Cook started' } }
        }
      },
      '/api/v1/collections/{id}/cook/pause': {
        post: {
          operationId: 'pauseCook',
          summary: 'Pause batch generation',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Cook paused' } }
        }
      },
      '/api/v1/collections/{id}/cook/resume': {
        post: {
          operationId: 'resumeCook',
          summary: 'Resume batch generation',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Cook resumed' } }
        }
      },
      '/api/v1/collections/{id}/cook/stop': {
        post: {
          operationId: 'stopCook',
          summary: 'Stop batch generation',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Cook stopped' } }
        }
      },
      '/api/v1/collections/{id}/export': {
        post: {
          operationId: 'exportCollection',
          summary: 'Export collection',
          description: 'Export approved pieces to a downloadable package.',
          tags: ['Collections'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Export started' } }
        }
      },
      // Trainings
      '/api/v1/trainings': {
        get: {
          operationId: 'listTrainings',
          summary: 'List your trainings',
          description: 'Get all LoRA training jobs for the authenticated user.',
          tags: ['Trainings'],
          security: [{ apiKey: [] }],
          responses: {
            '200': {
              description: 'List of trainings',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Training' } } } }
            }
          }
        },
        post: {
          operationId: 'createTraining',
          summary: 'Create a training job',
          description: 'Start training a custom LoRA model.',
          tags: ['Trainings'],
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingCreate' } } }
          },
          responses: {
            '200': {
              description: 'Training created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Training' } } }
            }
          }
        }
      },
      '/api/v1/trainings/calculate-cost': {
        post: {
          operationId: 'calculateTrainingCost',
          summary: 'Estimate training cost',
          description: 'Get cost estimate before starting a training job.',
          tags: ['Trainings'],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TrainingCreate' } } }
          },
          responses: {
            '200': {
              description: 'Cost estimate',
              content: { 'application/json': { schema: { type: 'object', properties: { cost: { type: 'number' }, currency: { type: 'string' } } } } }
            }
          }
        }
      },
      '/api/v1/trainings/{id}': {
        get: {
          operationId: 'getTraining',
          summary: 'Get training details',
          tags: ['Trainings'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Training details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Training' } } } }
          }
        },
        delete: {
          operationId: 'deleteTraining',
          summary: 'Delete training',
          tags: ['Trainings'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Training deleted' } }
        }
      },
      '/api/v1/trainings/{id}/retry': {
        post: {
          operationId: 'retryTraining',
          summary: 'Retry failed training',
          tags: ['Trainings'],
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { '200': { description: 'Training retried' } }
        }
      }
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authenticated endpoints'
        }
      },
      schemas: {
        Tool: {
          type: 'object',
          properties: {
            toolId: { type: 'string', description: 'Tool identifier for execution' },
            displayName: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', enum: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'upscale', 'image-to-text'] },
            inputSchema: { type: 'object', description: 'Parameter definitions' },
            costingModel: { type: 'object' },
            metadata: {
              type: 'object',
              properties: {
                baseModel: { type: 'string', description: 'Checkpoint for LoRA compatibility' }
              }
            }
          }
        },
        Lora: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            triggerWords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Include these words in prompts to activate this style'
            },
            description: { type: 'string' },
            checkpoint: { type: 'string', description: 'Compatible base model (FLUX, SDXL, SD1.5)' },
            defaultWeight: { type: 'number', description: 'Recommended strength (0.0-2.0)' },
            tags: { type: 'array', items: { type: 'string' } },
            previewImages: { type: 'array', items: { type: 'string' } }
          }
        },
        LoraListResponse: {
          type: 'object',
          properties: {
            loras: { type: 'array', items: { $ref: '#/components/schemas/Lora' } },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' }
          }
        },
        GenerationRequest: {
          type: 'object',
          required: ['toolId', 'parameters'],
          properties: {
            toolId: { type: 'string', description: 'Tool ID from /tools/registry' },
            parameters: {
              type: 'object',
              description: 'Tool-specific parameters. Always include "prompt" for image generation.',
              properties: {
                prompt: { type: 'string', description: 'Generation prompt. Include LoRA trigger words to apply styles.' },
                negative_prompt: { type: 'string', description: 'What to avoid in generation' },
                width: { type: 'integer' },
                height: { type: 'integer' }
              }
            },
            deliveryMode: {
              type: 'string',
              enum: ['immediate', 'async', 'webhook'],
              default: 'async'
            }
          }
        },
        GenerationResponse: {
          type: 'object',
          properties: {
            generationId: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
            estimatedDuration: { type: 'integer', description: 'Estimated time in milliseconds' }
          }
        },
        GenerationStatus: {
          type: 'object',
          properties: {
            generationId: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
            progress: { type: 'integer', minimum: 0, maximum: 100 },
            result: {
              type: 'object',
              properties: {
                image: { type: 'string', description: 'URL of generated image' },
                video: { type: 'string', description: 'URL of generated video' }
              }
            },
            error: { type: 'string' }
          }
        },
        CreditBalance: {
          type: 'object',
          properties: {
            balance: { type: 'number' },
            currency: { type: 'string', default: 'points' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        },
        // Spell schemas
        SpellList: {
          type: 'object',
          properties: {
            spells: { type: 'array', items: { $ref: '#/components/schemas/Spell' } }
          }
        },
        Spell: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            visibility: { type: 'string', enum: ['public', 'private'] },
            steps: { type: 'array', items: { type: 'object' } },
            inputs: { type: 'array', items: { type: 'object' } }
          }
        },
        SpellCastRequest: {
          type: 'object',
          required: ['spellId'],
          properties: {
            spellId: { type: 'string', description: 'Spell ID or slug' },
            parameters: { type: 'object', description: 'Input parameters for the spell' }
          }
        },
        SpellCastResponse: {
          type: 'object',
          properties: {
            castId: { type: 'string' },
            status: { type: 'string' }
          }
        },
        SpellCastStatus: {
          type: 'object',
          properties: {
            castId: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
            progress: { type: 'integer' },
            results: { type: 'object' }
          }
        },
        // Collection schemas
        Collection: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['idle', 'cooking', 'paused', 'completed'] },
            totalPieces: { type: 'integer' },
            approvedPieces: { type: 'integer' },
            config: { type: 'object' }
          }
        },
        CollectionCreate: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            targetCount: { type: 'integer', description: 'Number of pieces to generate' },
            toolId: { type: 'string', description: 'Generation tool to use' },
            promptTemplate: { type: 'string' },
            config: { type: 'object' }
          }
        },
        // Training schemas
        Training: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
            modelType: { type: 'string', enum: ['FLUX', 'SDXL', 'SD1.5', 'WAN', 'KONTEXT'] },
            progress: { type: 'integer' },
            triggerWords: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        TrainingCreate: {
          type: 'object',
          required: ['name', 'modelType', 'datasetId'],
          properties: {
            name: { type: 'string' },
            modelType: { type: 'string', enum: ['FLUX', 'SDXL', 'SD1.5', 'WAN', 'KONTEXT'] },
            datasetId: { type: 'string', description: 'ID of uploaded training dataset' },
            triggerWords: { type: 'array', items: { type: 'string' } },
            steps: { type: 'integer', default: 1000 },
            learningRate: { type: 'number' },
            loraRank: { type: 'integer', default: 16 },
            loraAlpha: { type: 'integer', default: 32 }
          }
        }
      }
    },
    tags: [
      { name: 'Discovery', description: 'Public endpoints for discovering tools and LoRAs' },
      { name: 'Generation', description: 'Execute generations (requires API key)' },
      { name: 'Spells', description: 'Reusable generation workflows' },
      { name: 'Collections', description: 'Batch generation and curation' },
      { name: 'Trainings', description: 'Custom LoRA model training' },
      { name: 'User', description: 'User account and credits' }
    ]
  };

  return spec;
}

module.exports = { createSkillRouter };
