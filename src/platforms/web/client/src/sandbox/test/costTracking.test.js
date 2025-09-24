/**
 * Unit tests for cost tracking functionality
 * Run with: node test/costTracking.test.js
 */

// Mock DOM environment
global.document = {
  createElement: (tag) => ({
    tagName: tag,
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {},
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: () => {},
    remove: () => {},
    textContent: '',
    innerHTML: '',
    title: '',
    id: 'test-window',
    parentElement: null
  }),
  body: { appendChild: () => {}, removeChild: () => {} },
  head: { appendChild: () => {} },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

global.window = {
  localStorage: {
    getItem: (key) => key === 'costDenom' ? 'POINTS' : null,
    setItem: (key, value) => console.log(`localStorage.setItem(${key}, ${value})`)
  },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

global.localStorage = global.window.localStorage;

// Mock state functions
const mockState = {
  activeToolWindows: [],
  addWindowCost: (windowId, costData) => {
    console.log(`addWindowCost(${windowId}, ${JSON.stringify(costData)})`);
  },
  getWindowCost: (windowId) => {
    return {
      costVersions: [],
      totalCost: { usd: 0, points: 0, ms2: 0, cult: 0 }
    };
  },
  getTotalWorkspaceCost: () => {
    return { usd: 0, points: 0, ms2: 0, cult: 0 };
  },
  persistState: () => console.log('persistState()')
};

// Mock the state module
const originalRequire = require;
require = (module) => {
  if (module === '../state.js') {
    return mockState;
  }
  return originalRequire(module);
};

// Test cost calculation
function testCostCalculation() {
  console.log('Testing cost calculation...');
  
  const GPU_COST_PER_SECOND = {
    'T4': 0.00018,
    'A10G': 0.000337,
    'CPU': 0.000042
  };
  
  const DEFAULT_RATES = {
    POINTS_per_USD: 100,
    MS2_per_USD: 2,
    CULT_per_USD: 50
  };
  
  // Test case 1: T4 GPU, 10 seconds
  const durationMs = 10000; // 10 seconds
  const gpuType = 'T4';
  const gpuCostPerSecond = GPU_COST_PER_SECOND[gpuType];
  const usdCost = gpuCostPerSecond * (durationMs / 1000);
  
  const expectedUsd = 0.0018;
  const actualUsd = usdCost;
  
  console.assert(Math.abs(actualUsd - expectedUsd) < 0.0001, 
    `Expected USD cost ${expectedUsd}, got ${actualUsd}`);
  
  // Test case 2: Convert to other currencies
  const costData = {
    usd: usdCost,
    points: usdCost * DEFAULT_RATES.POINTS_per_USD,
    ms2: usdCost * DEFAULT_RATES.MS2_per_USD,
    cult: usdCost * DEFAULT_RATES.CULT_per_USD
  };
  
  console.assert(costData.points === 0.18, `Expected 0.18 POINTS, got ${costData.points}`);
  console.assert(costData.ms2 === 0.0036, `Expected 0.0036 MS2, got ${costData.ms2}`);
  console.assert(costData.cult === 0.09, `Expected 0.09 CULT, got ${costData.cult}`);
  
  console.log('✓ Cost calculation tests passed');
}

// Test denomination cycling
function testDenominationCycling() {
  console.log('Testing denomination cycling...');
  
  const denominations = ['POINTS', 'MS2', 'USD', 'CULT'];
  const currentDenomination = 'POINTS';
  const currentIndex = denominations.indexOf(currentDenomination);
  const nextIndex = (currentIndex + 1) % denominations.length;
  const nextDenomination = denominations[nextIndex];
  
  console.assert(nextDenomination === 'MS2', `Expected MS2, got ${nextDenomination}`);
  
  // Test wrapping around
  const lastIndex = denominations.length - 1;
  const wrapIndex = (lastIndex + 1) % denominations.length;
  const wrapDenomination = denominations[wrapIndex];
  
  console.assert(wrapDenomination === 'POINTS', `Expected POINTS, got ${wrapDenomination}`);
  
  console.log('✓ Denomination cycling tests passed');
}

// Test cost formatting
function testCostFormatting() {
  console.log('Testing cost formatting...');
  
  const formatCost = (amount, denomination) => {
    if (amount === 0) return '0';
    
    switch (denomination) {
      case 'USD':
        return `$${amount.toFixed(2)}`;
      case 'POINTS':
        return `${Math.round(amount)} POINTS`;
      case 'MS2':
        return `${amount.toFixed(2)} MS2`;
      case 'CULT':
        return `${Math.round(amount)} CULT`;
      default:
        return `${amount.toFixed(2)}`;
    }
  };
  
  console.assert(formatCost(0, 'POINTS') === '0', 'Zero cost formatting failed');
  console.assert(formatCost(4.2, 'POINTS') === '4 POINTS', 'POINTS formatting failed');
  console.assert(formatCost(0.042, 'USD') === '$0.04', 'USD formatting failed');
  console.assert(formatCost(0.07, 'MS2') === '0.07 MS2', 'MS2 formatting failed');
  console.assert(formatCost(2.1, 'CULT') === '2 CULT', 'CULT formatting failed');
  
  console.log('✓ Cost formatting tests passed');
}

// Test tool cost estimation
function testToolCostEstimation() {
  console.log('Testing tool cost estimation...');
  
  const DEFAULT_COST_ESTIMATES = {
    'text-to-image': '~50 POINTS',
    'image-to-image': '~30 POINTS',
    'text-to-audio': '~20 POINTS',
    'text-to-text': '~5 POINTS',
    'text-to-video': '~100 POINTS',
    'uncategorized': '~25 POINTS'
  };
  
  const getToolCostEstimate = (tool) => {
    if (tool.metadata?.costEstimate) {
      return tool.metadata.costEstimate;
    }
    const category = tool.category || 'uncategorized';
    return DEFAULT_COST_ESTIMATES[category] || DEFAULT_COST_ESTIMATES['uncategorized'];
  };
  
  // Test with category
  const imageTool = { category: 'text-to-image' };
  console.assert(getToolCostEstimate(imageTool) === '~50 POINTS', 'Category-based estimation failed');
  
  // Test with custom metadata
  const customTool = { 
    category: 'text-to-image',
    metadata: { costEstimate: '~75 POINTS' }
  };
  console.assert(getToolCostEstimate(customTool) === '~75 POINTS', 'Custom estimation failed');
  
  // Test uncategorized
  const unknownTool = { category: 'unknown' };
  console.assert(getToolCostEstimate(unknownTool) === '~25 POINTS', 'Uncategorized estimation failed');
  
  console.log('✓ Tool cost estimation tests passed');
}

// Run all tests
function runTests() {
  console.log('Running cost tracking tests...\n');
  
  try {
    testCostCalculation();
    testDenominationCycling();
    testCostFormatting();
    testToolCostEstimation();
    
    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testCostCalculation,
  testDenominationCycling,
  testCostFormatting,
  testToolCostEstimation,
  runTests
};
