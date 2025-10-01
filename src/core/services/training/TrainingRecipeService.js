/**
 * Training Recipe Service
 * 
 * Registry and management for training recipes (FLUX, WAN, SDXL)
 */

const SDXLRecipe = require('./recipes/SDXLRecipe');
const FLUXRecipe = require('./recipes/FLUXRecipe');
const WANRecipe = require('./recipes/WANRecipe');

class TrainingRecipeService {
  constructor({ logger }) {
    this.logger = logger;
    this.recipes = new Map();
    
    // Register available recipes
    this.registerRecipes();
  }

  /**
   * Register all available training recipes
   */
  registerRecipes() {
    try {
      // Register SDXL recipe
      const sdxlRecipe = new SDXLRecipe({ logger: this.logger });
      this.recipes.set('SDXL', sdxlRecipe);
      this.recipes.set('SD1.5', sdxlRecipe); // SD1.5 uses same recipe as SDXL
      
      // Register FLUX recipe
      const fluxRecipe = new FLUXRecipe({ logger: this.logger });
      this.recipes.set('FLUX', fluxRecipe);
      
      // Register WAN recipe
      const wanRecipe = new WANRecipe({ logger: this.logger });
      this.recipes.set('WAN', wanRecipe);
      
      this.logger.info(`Registered ${this.recipes.size} training recipes: ${Array.from(this.recipes.keys()).join(', ')}`);
      
    } catch (error) {
      this.logger.error('Failed to register training recipes:', error);
      throw error;
    }
  }

  /**
   * Get recipe for a specific model type
   * @param {string} modelType - Model type (SDXL, FLUX, WAN, etc.)
   * @returns {Object|null} Recipe object or null if not found
   */
  getRecipe(modelType) {
    const recipe = this.recipes.get(modelType);
    if (!recipe) {
      this.logger.warn(`No recipe found for model type: ${modelType}`);
      return null;
    }
    return recipe;
  }

  /**
   * Get all available model types
   * @returns {Array<string>} Array of supported model types
   */
  getAvailableModelTypes() {
    return Array.from(this.recipes.keys());
  }

  /**
   * Get recipe information
   * @param {string} modelType - Model type
   * @returns {Object|null} Recipe information or null if not found
   */
  getRecipeInfo(modelType) {
    const recipe = this.getRecipe(modelType);
    if (!recipe) {
      return null;
    }
    
    return {
      modelType,
      name: recipe.getName(),
      description: recipe.getDescription(),
      baseImage: recipe.getBaseImage(),
      supportedFormats: recipe.getSupportedFormats(),
      defaultSteps: recipe.getDefaultSteps(),
      defaultLearningRate: recipe.getDefaultLearningRate(),
      gpuRequired: recipe.isGpuRequired(),
      estimatedTime: recipe.getEstimatedTime()
    };
  }

  /**
   * Get all recipe information
   * @returns {Array<Object>} Array of all recipe information
   */
  getAllRecipeInfo() {
    return this.getAvailableModelTypes().map(modelType => 
      this.getRecipeInfo(modelType)
    ).filter(info => info !== null);
  }

  /**
   * Validate training configuration for a model type
   * @param {string} modelType - Model type
   * @param {Object} config - Training configuration
   * @returns {Object} Validation result
   */
  validateConfig(modelType, config) {
    const recipe = this.getRecipe(modelType);
    if (!recipe) {
      return {
        valid: false,
        errors: [`Unsupported model type: ${modelType}`]
      };
    }
    
    return recipe.validateConfig(config);
  }

  /**
   * Get default configuration for a model type
   * @param {string} modelType - Model type
   * @returns {Object|null} Default configuration or null if not found
   */
  getDefaultConfig(modelType) {
    const recipe = this.getRecipe(modelType);
    if (!recipe) {
      return null;
    }
    
    return recipe.getDefaultConfig();
  }

  /**
   * Check if a model type is supported
   * @param {string} modelType - Model type to check
   * @returns {boolean} True if supported
   */
  isModelTypeSupported(modelType) {
    return this.recipes.has(modelType);
  }

  /**
   * Get training requirements for a model type
   * @param {string} modelType - Model type
   * @returns {Object|null} Training requirements or null if not found
   */
  getTrainingRequirements(modelType) {
    const recipe = this.getRecipe(modelType);
    if (!recipe) {
      return null;
    }
    
    return {
      minImages: recipe.getMinImages(),
      maxImages: recipe.getMaxImages(),
      recommendedImages: recipe.getRecommendedImages(),
      imageSize: recipe.getImageSize(),
      supportedFormats: recipe.getSupportedFormats(),
      gpuRequired: recipe.isGpuRequired(),
      estimatedTime: recipe.getEstimatedTime(),
      costPoints: recipe.getCostPoints()
    };
  }

  /**
   * Get service status
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      registeredRecipes: this.recipes.size,
      availableModelTypes: this.getAvailableModelTypes(),
      recipes: this.getAllRecipeInfo()
    };
  }
}

module.exports = TrainingRecipeService;
