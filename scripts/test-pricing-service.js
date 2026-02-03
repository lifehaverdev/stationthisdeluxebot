#!/usr/bin/env node
/**
 * Quick verification script for pricing service
 * Run: node scripts/test-pricing-service.js
 */

const { getPricingService, PRICING_CONFIG } = require('../src/core/services/pricing');

const logger = {
  debug: (...args) => console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
};

const pricingService = getPricingService(logger);

console.log('\n=== PRICING SERVICE VERIFICATION ===\n');

// Show current config
console.log('Current Config:');
console.log('  Version:', PRICING_CONFIG.version);
console.log('  ComfyUI Standard Multiplier:', PRICING_CONFIG.platformFeeMultipliers.comfyui.standard + 'x');
console.log('  ComfyUI MS2 Multiplier:', PRICING_CONFIG.platformFeeMultipliers.comfyui.ms2 + 'x');
console.log('  MS2 Token Address:', PRICING_CONFIG.ms2Benefits.tokenAddress);
console.log('');

// Test scenarios
const testCases = [
  { computeCostUsd: 0.01, serviceName: 'comfyui', isMs2User: false, description: 'Standard user, $0.01 compute' },
  { computeCostUsd: 0.01, serviceName: 'comfyui', isMs2User: true, description: 'MS2 user, $0.01 compute' },
  { computeCostUsd: 0.05, serviceName: 'comfyui', isMs2User: false, description: 'Standard user, $0.05 compute' },
  { computeCostUsd: 0.05, serviceName: 'comfyui', isMs2User: true, description: 'MS2 user, $0.05 compute' },
  { computeCostUsd: 0.001, serviceName: 'default', isMs2User: false, description: 'Non-comfyui service (no multiplier)' },
];

console.log('Test Scenarios:\n');
console.log('| Scenario | Compute USD | Multiplier | Final USD | Points | Tier |');
console.log('|----------|-------------|------------|-----------|--------|------|');

for (const tc of testCases) {
  const quote = pricingService.getQuote(tc);
  console.log(`| ${tc.description.padEnd(35)} | $${tc.computeCostUsd.toFixed(3).padStart(5)} | ${quote.multiplier}x | $${quote.finalCostUsd.toFixed(4).padStart(7)} | ${String(quote.totalPoints).padStart(6)} | ${quote.tier.padEnd(8)} |`);
}

console.log('');

// Verify MS2 detection (uses snake_case field names from database)
console.log('MS2 Deposit Detection:');
const ms2Deposit = {
  token_address: '0x98ed411b8cf8536657c660db8aa55d9d4baaf820',
  usd_value_at_deposit: 5.00,
  status: 'confirmed'
};
const otherDeposit = {
  token_address: '0x0000000000000000000000000000000000000000',
  usd_value_at_deposit: 10.00,
  status: 'confirmed'
};

console.log('  MS2 deposit qualifies?', pricingService.isMs2Deposit(ms2Deposit));
console.log('  Other deposit qualifies?', pricingService.isMs2Deposit(otherDeposit));
console.log('  User with [ms2Deposit] qualifies for MS2 pricing?', pricingService.userQualifiesForMs2Pricing([ms2Deposit]));
console.log('  User with [otherDeposit] qualifies for MS2 pricing?', pricingService.userQualifiesForMs2Pricing([otherDeposit]));

console.log('');

// Simulate webhook scenario
console.log('=== SIMULATED WEBHOOK SCENARIO ===\n');
const simulatedComputeCost = 0.0337; // ~100 seconds at A10G rate
console.log(`ComfyUI job completed: ${(simulatedComputeCost / 0.000337).toFixed(0)} seconds at A10G rate`);
console.log(`Raw compute cost: $${simulatedComputeCost.toFixed(4)}`);
console.log('');

const standardQuote = pricingService.getQuote({ computeCostUsd: simulatedComputeCost, serviceName: 'comfyui', isMs2User: false });
const ms2Quote = pricingService.getQuote({ computeCostUsd: simulatedComputeCost, serviceName: 'comfyui', isMs2User: true });

console.log('Standard User:');
console.log(`  Multiplier: ${standardQuote.multiplier}x`);
console.log(`  Platform fee: $${standardQuote.platformFeeUsd.toFixed(4)}`);
console.log(`  Total charge: $${standardQuote.finalCostUsd.toFixed(4)} = ${standardQuote.totalPoints} points`);
console.log('');

console.log('MS2 Token Holder:');
console.log(`  Multiplier: ${ms2Quote.multiplier}x`);
console.log(`  Platform fee: $${ms2Quote.platformFeeUsd.toFixed(4)}`);
console.log(`  Total charge: $${ms2Quote.finalCostUsd.toFixed(4)} = ${ms2Quote.totalPoints} points`);
console.log(`  Savings: $${(standardQuote.finalCostUsd - ms2Quote.finalCostUsd).toFixed(4)} (${((1 - ms2Quote.finalCostUsd / standardQuote.finalCostUsd) * 100).toFixed(0)}%)`);

console.log('\n=== VERIFICATION COMPLETE ===\n');
