// scripts/debug/verifyEnumCache.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { initializeServices } = require('../../src/core/services');
const { createLogger } = require('../../src/utils/logger');

async function verifyEnumCache() {
  const logger = createLogger();
  logger.info('--- Verifying Model Enum Caching ---');

  try {
    // 1. Initialize all services
    const services = await initializeServices({ logger });
    logger.info('Core services object created.');

    // 2. The `WorkflowsService` initialization is what triggers the caching.
    // This mimics the sequence in `app.js`.
    if (services.workflows && typeof services.workflows.initialize === 'function') {
      logger.info('Initializing WorkflowsService cache...');
      await services.workflows.initialize();
      logger.info('WorkflowsService cache initialized.');
    } else {
      logger.error('WorkflowsService not found or does not have an initialize method.');
      return;
    }

    // 3. Access the cache manager from the workflows service
    // We need a way to get the cache manager instance. Let's assume a getter for now.
    const workflowCacheManager = services.workflows.getCacheManager();
    if (!workflowCacheManager) {
        logger.error('Could not get WorkflowCacheManager instance from WorkflowsService.');
        return;
    }

    const modelEnums = workflowCacheManager.cache.modelEnums;

    if (!modelEnums || modelEnums.length === 0) {
      logger.warn('Verification Result: The `modelEnums` cache is empty.');
      logger.info('This could be because no workflows with ComfyUIDeployExternalEnum widgets were found, or there was an issue during processing.');
    } else {
      logger.info(`✅ Verification Result: Success! Found ${modelEnums.length} model enums in the cache.`);
      logger.info('--- Sample of cached enums (up to 5) ---');
      
      const sample = modelEnums.slice(0, 5);
      sample.forEach((item, index) => {
        logger.info(`${index + 1}: ${JSON.stringify(item)}`);
      });

      const categories = [...new Set(modelEnums.map(e => e.category))];
      logger.info(`--- Found ${categories.length} unique categories ---`);
      logger.info(categories.join(', '));
    }

  } catch (error) {
    logger.error('Error during verification script:', error);
    process.exit(1);
  }
}

verifyEnumCache(); 