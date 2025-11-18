#!/usr/bin/env node
/**
 * spellCostValidation.js
 * ---------------------------------------------
 * Database validation script for spell cost estimation investigation.
 * Analyzes generationOutputs and casts collections to identify cost tracking issues.
 *
 * Usage:
 *   node scripts/investigate/spellCostValidation.js
 *   node scripts/investigate/spellCostValidation.js --detailed
 */

const path = require('path');
const { ObjectId } = require('mongodb');
const GenerationOutputsDB = require(path.join(__dirname, '../../src/core/services/db/generationOutputsDb'));
const CastsDB = require(path.join(__dirname, '../../src/core/services/db/castsDb'));
const SpellsDB = require(path.join(__dirname, '../../src/core/services/db/spellsDb'));

const logger = console;

/**
 * Convert Decimal128 or other cost formats to number
 */
function parseCost(costUsd) {
  if (costUsd === null || costUsd === undefined) return null;
  if (typeof costUsd === 'number') return costUsd;
  if (typeof costUsd === 'object') {
    if (costUsd._bsontype === 'Decimal128') {
      return parseFloat(costUsd.toString());
    }
    if (costUsd.$numberDecimal) {
      return parseFloat(costUsd.$numberDecimal);
    }
  }
  if (typeof costUsd === 'string') {
    return parseFloat(costUsd);
  }
  return null;
}

/**
 * Part 1: Analyze OpenAI tool executions in generationOutputs
 */
async function analyzeOpenAIToolExecutions(generationOutputsDb) {
  logger.log('\n========== PART 1: OpenAI Tool Execution Analysis ==========');
  
  const openaiServiceNames = ['openai', 'chatgpt-free', 'dall-e-3-image', 'dall-e-2', 'dall-e-3'];
  
  // Query 1: Cost distribution for OpenAI tools
  const costDistribution = await generationOutputsDb.aggregate([
    {
      $match: {
        serviceName: { $in: openaiServiceNames },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: '$serviceName',
        total: { $sum: 1 },
        withCost: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$costUsd', null] },
                  { $ne: ['$costUsd', 0] }
                ]
              },
              1,
              0
            ]
          }
        },
        withZeroCost: {
          $sum: {
            $cond: [{ $eq: ['$costUsd', 0] }, 1, 0]
          }
        },
        withNullCost: {
          $sum: {
            $cond: [{ $eq: ['$costUsd', null] }, 1, 0]
          }
        },
        avgCost: { $avg: '$costUsd' },
        minCost: { $min: '$costUsd' },
        maxCost: { $max: '$costUsd' }
      }
    },
    { $sort: { total: -1 } }
  ]);

  logger.log('\n-- Cost Distribution by Service Name --');
  costDistribution.forEach(stat => {
    const avgCost = parseCost(stat.avgCost);
    const minCost = parseCost(stat.minCost);
    const maxCost = parseCost(stat.maxCost);
    const costCoverage = ((stat.withCost / stat.total) * 100).toFixed(1);
    
    logger.log(`\n${stat._id}:`);
    logger.log(`  Total executions: ${stat.total}`);
    logger.log(`  With valid cost (>0): ${stat.withCost} (${costCoverage}%)`);
    logger.log(`  With zero cost: ${stat.withZeroCost}`);
    logger.log(`  With null cost: ${stat.withNullCost}`);
    logger.log(`  Avg cost: $${avgCost?.toFixed(4) || 'N/A'}`);
    logger.log(`  Min cost: $${minCost?.toFixed(4) || 'N/A'}`);
    logger.log(`  Max cost: $${maxCost?.toFixed(4) || 'N/A'}`);
  });

  // Query 2: ToolId vs ServiceName mismatch analysis
  const toolIdAnalysis = await generationOutputsDb.aggregate([
    {
      $match: {
        serviceName: { $in: openaiServiceNames },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: {
          serviceName: '$serviceName',
          toolId: '$toolId'
        },
        count: { $sum: 1 },
        avgCost: { $avg: '$costUsd' }
      }
    },
    { $sort: { count: -1 } }
  ]);

  logger.log('\n-- ToolId vs ServiceName Combinations --');
  toolIdAnalysis.forEach(combo => {
    const avgCost = parseCost(combo.avgCost);
    logger.log(`serviceName: "${combo._id.serviceName}", toolId: "${combo._id.toolId}"`);
    logger.log(`  Count: ${combo.count}, Avg Cost: $${avgCost?.toFixed(4) || 'N/A'}`);
  });

  // Query 3: Recent executions sample
  const recentExecutions = await generationOutputsDb.findMany(
    {
      serviceName: { $in: openaiServiceNames },
      status: 'completed'
    },
    {
      limit: 10,
      sort: { responseTimestamp: -1 },
      projection: {
        _id: 1,
        serviceName: 1,
        toolId: 1,
        toolDisplayName: 1,
        costUsd: 1,
        status: 1,
        responseTimestamp: 1
      }
    }
  );

  logger.log('\n-- Recent OpenAI Executions (Sample of 10) --');
  recentExecutions.forEach(gen => {
    const cost = parseCost(gen.costUsd);
    logger.log(`${gen._id} | ${gen.serviceName} | ${gen.toolId} | cost: $${cost?.toFixed(4) || 'null'} | ${gen.responseTimestamp?.toISOString?.()}`);
  });

  return {
    costDistribution,
    toolIdAnalysis,
    recentExecutions
  };
}

/**
 * Part 2: Analyze spell casts and their cost aggregation
 */
async function analyzeSpellCasts(castsDb) {
  logger.log('\n========== PART 2: Spell Cast Cost Analysis ==========');
  
  // Query 1: Casts with generation linking
  const castsWithCosts = await castsDb.aggregate([
    {
      $lookup: {
        from: 'generationOutputs',
        localField: 'stepGenerationIds',
        foreignField: '_id',
        as: 'generations'
      }
    },
    {
      $project: {
        spellId: 1,
        status: 1,
        startedAt: 1,
        generationCount: { $size: '$generations' },
        totalCost: {
          $sum: {
            $map: {
              input: '$generations',
              as: 'gen',
              in: {
                $cond: [
                  { $ne: ['$$gen.costUsd', null] },
                  { $ifNull: ['$$gen.costUsd', 0] },
                  0
                ]
              }
            }
          }
        },
        generationsWithCost: {
          $size: {
            $filter: {
              input: '$generations',
              as: 'gen',
              cond: {
                $and: [
                  { $ne: ['$$gen.costUsd', null] },
                  { $ne: ['$$gen.costUsd', 0] }
                ]
              }
            }
          }
        }
      }
    },
    { $sort: { startedAt: -1 } },
    { $limit: 20 }
  ]);

  logger.log('\n-- Recent Spell Casts with Cost Aggregation (Sample of 20) --');
  castsWithCosts.forEach(cast => {
    const totalCost = parseCost(cast.totalCost);
    logger.log(`Cast ${cast._id}:`);
    logger.log(`  Spell: ${cast.spellId}`);
    logger.log(`  Status: ${cast.status}`);
    logger.log(`  Generations: ${cast.generationCount}`);
    logger.log(`  Generations with cost: ${cast.generationsWithCost}`);
    logger.log(`  Total cost: $${totalCost?.toFixed(4) || '0.0000'}`);
    logger.log(`  Started: ${cast.startedAt?.toISOString?.()}`);
    logger.log('');
  });

  // Query 2: Casts with zero or null costs
  const zeroCostCasts = await castsDb.aggregate([
    {
      $lookup: {
        from: 'generationOutputs',
        localField: 'stepGenerationIds',
        foreignField: '_id',
        as: 'generations'
      }
    },
    {
      $match: {
        $or: [
          { generations: { $size: 0 } },
          {
            $expr: {
              $eq: [
                {
                  $sum: {
                    $map: {
                      input: '$generations',
                      as: 'gen',
                      in: {
                        $cond: [
                          { $ne: ['$$gen.costUsd', null] },
                          { $ifNull: ['$$gen.costUsd', 0] },
                          0
                        ]
                      }
                    }
                  }
                },
                0
              ]
            }
          }
        ]
      }
    },
    { $count: 'total' }
  ]);

  const zeroCostCount = zeroCostCasts[0]?.total || 0;
  logger.log(`\n-- Casts with Zero or Missing Costs: ${zeroCostCount} total --`);

  return {
    castsWithCosts,
    zeroCostCount
  };
}

/**
 * Part 3: Cross-reference spell definitions with execution data
 */
async function analyzeSpellQuotes(spellsDb, generationOutputsDb) {
  logger.log('\n========== PART 3: Spell Quote vs Execution Analysis ==========');
  
  // Get all spells
  const spells = await spellsDb.findMany({}, { limit: 50 });
  logger.log(`\nAnalyzing ${spells.length} spells...`);

  const spellAnalysis = [];

  for (const spell of spells) {
    if (!spell.steps || spell.steps.length === 0) continue;

    const stepToolIds = spell.steps
      .map(s => s.toolIdentifier || s.toolId)
      .filter(Boolean);

    if (stepToolIds.length === 0) continue;

    // Query historical data for each tool in the spell
    const toolStats = [];
    for (const toolId of stepToolIds) {
      // Try matching by serviceName (current bug - should match toolId)
      const byServiceName = await generationOutputsDb.aggregate([
        {
          $match: {
            serviceName: toolId,
            status: 'completed',
            costUsd: { $exists: true }
          }
        },
        { $sort: { responseTimestamp: -1 } },
        { $limit: 10 },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgCost: { $avg: '$costUsd' }
          }
        }
      ]);

      // Try matching by toolId (correct approach)
      const byToolId = await generationOutputsDb.aggregate([
        {
          $match: {
            toolId: toolId,
            status: 'completed',
            costUsd: { $exists: true }
          }
        },
        { $sort: { responseTimestamp: -1 } },
        { $limit: 10 },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgCost: { $avg: '$costUsd' }
          }
        }
      ]);

      toolStats.push({
        toolId,
        byServiceName: byServiceName[0] || null,
        byToolId: byToolId[0] || null
      });
    }

    const hasData = toolStats.some(stat => 
      (stat.byServiceName?.count > 0) || (stat.byToolId?.count > 0)
    );

    if (!hasData) continue;

    spellAnalysis.push({
      spellId: spell._id,
      spellName: spell.name,
      slug: spell.slug,
      steps: spell.steps.length,
      toolStats
    });
  }

  logger.log('\n-- Spell Quote Analysis --');
  spellAnalysis.forEach(analysis => {
    logger.log(`\nSpell: ${analysis.spellName} (${analysis.slug})`);
    logger.log(`  Steps: ${analysis.steps}`);
    analysis.toolStats.forEach(stat => {
      const byServiceName = stat.byServiceName;
      const byToolId = stat.byToolId;
      const serviceNameCount = byServiceName?.count || 0;
      const toolIdCount = byToolId?.count || 0;
      const serviceNameAvg = parseCost(byServiceName?.avgCost);
      const toolIdAvg = parseCost(byToolId?.avgCost);

      logger.log(`  Tool: ${stat.toolId}`);
      logger.log(`    By serviceName (WRONG): ${serviceNameCount} records, avg: $${serviceNameAvg?.toFixed(4) || 'N/A'}`);
      logger.log(`    By toolId (CORRECT): ${toolIdCount} records, avg: $${toolIdAvg?.toFixed(4) || 'N/A'}`);
    });
  });

  return spellAnalysis;
}

/**
 * Generate summary report
 */
function generateSummaryReport(openaiResults, castResults, spellResults) {
  logger.log('\n========== SUMMARY REPORT ==========');
  
  // Calculate overall statistics
  let totalOpenAIExecutions = 0;
  let totalWithCost = 0;
  let totalWithZeroCost = 0;
  let totalWithNullCost = 0;

  openaiResults.costDistribution.forEach(stat => {
    totalOpenAIExecutions += stat.total;
    totalWithCost += stat.withCost;
    totalWithZeroCost += stat.withZeroCost;
    totalWithNullCost += stat.withNullCost;
  });

  const costCoverage = totalOpenAIExecutions > 0 
    ? ((totalWithCost / totalOpenAIExecutions) * 100).toFixed(1)
    : '0.0';

  logger.log('\n-- Overall Statistics --');
  logger.log(`Total OpenAI executions: ${totalOpenAIExecutions}`);
  logger.log(`Executions with valid cost: ${totalWithCost} (${costCoverage}%)`);
  logger.log(`Executions with zero cost: ${totalWithZeroCost}`);
  logger.log(`Executions with null cost: ${totalWithNullCost}`);
  logger.log(`Casts with zero/missing costs: ${castResults.zeroCostCount}`);

  logger.log('\n-- Key Findings --');
  logger.log('1. OpenAI adapter does not return costUsd in ToolResult');
  logger.log('2. OpenAI service does not extract usage/token data from API responses');
  logger.log('3. Spell quote queries match on serviceName instead of toolId');
  logger.log('4. Generation records use serviceName="openai" but quotes search for toolId');
  logger.log('5. Cost calculation relies on pre-execution estimates, not actual API costs');

  logger.log('\n-- Recommendations --');
  logger.log('1. Update openAIAdapter to calculate and return costUsd based on API usage');
  logger.log('2. Update openaiService to extract and return usage data from responses');
  logger.log('3. Fix SpellsService.quoteSpell() to match on toolId instead of serviceName');
  logger.log('4. Add fallback cost calculation for tools without execution history');
  logger.log('5. Implement cost reconciliation between estimates and actual costs');
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const detailed = args.includes('--detailed');

  logger.log('========================================');
  logger.log('Spell Cost Estimation Validation Script');
  logger.log('========================================');

  const generationOutputsDb = new GenerationOutputsDB(logger);
  const castsDb = new CastsDB(logger);
  const spellsDb = new SpellsDB(logger);

  try {
    const openaiResults = await analyzeOpenAIToolExecutions(generationOutputsDb);
    const castResults = await analyzeSpellCasts(castsDb);
    const spellResults = await analyzeSpellQuotes(spellsDb, generationOutputsDb);

    generateSummaryReport(openaiResults, castResults, spellResults);

    logger.log('\n========================================');
    logger.log('Validation complete!');
    logger.log('========================================');
  } catch (error) {
    logger.error('Error during validation:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, analyzeOpenAIToolExecutions, analyzeSpellCasts, analyzeSpellQuotes };

