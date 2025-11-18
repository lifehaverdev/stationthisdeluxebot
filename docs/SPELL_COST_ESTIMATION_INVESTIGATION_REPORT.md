# Spell Cost Estimation Investigation Report

**Date:** 2025-01-30  
**Investigation Scope:** 3-part analysis of spell cost estimation system

## Executive Summary

The spell cost estimation system is failing to provide accurate cost estimates for spells using OpenAI tools (ChatGPT, DALL-E). The investigation identified **5 critical issues** preventing proper cost tracking and estimation:

1. **OpenAI adapter does not return `costUsd`** in ToolResult
2. **OpenAI service does not extract usage data** from API responses
3. **Spell quote queries match on wrong field** (serviceName instead of toolId)
4. **Generation records use serviceName="openai"** but quotes search for toolId
5. **Cost calculation relies on pre-execution estimates** instead of actual API costs

## Part 1: OpenAI Service Cost Configuration Investigation

### Findings

#### Issue 1.1: OpenAI Adapter Missing Cost Calculation

**Location:** `src/core/services/openai/openAIAdapter.js`

**Problem:**
- `execute()` method (lines 34-49) returns ToolResult **without `costUsd` field**
- `startJob()` method (line 74) hardcodes `costUsd: 0` in ToolResult
- Adapter never calculates actual costs from API responses

**Evidence:**
```javascript
// Line 39 - execute() for chat
return { type: 'text', data: { text }, status: 'succeeded' }; // ❌ No costUsd

// Line 46 - execute() for image  
return { type: 'image', data: { images: [image] }, status: 'succeeded' }; // ❌ No costUsd

// Line 74 - startJob() for image
const toolResult = { type: 'image', data: { images: [image] }, status: 'succeeded', costUsd: 0 }; // ❌ Hardcoded 0
```

**Impact:** Generation records fall back to pre-calculated `costUsd` which may be incorrect or 0.

#### Issue 1.2: OpenAI Service Does Not Extract Usage Data

**Location:** `src/core/services/openai/openaiService.js`

**Problem:**
- `executeChatCompletion()` (line 66) only returns `responseContent` (text)
- Full completion object with `usage` field (containing `prompt_tokens`, `completion_tokens`, `total_tokens`) is discarded
- No token usage data available for cost calculation

**Evidence:**
```javascript
// Line 66-68
const responseContent = completion.choices[0]?.message?.content;
if (responseContent) {
  return responseContent; // ❌ Discards completion.usage
}
```

**Impact:** Cannot calculate actual costs based on token usage. Must rely on estimates.

#### Issue 1.3: Cost Calculation Flow

**Location:** `src/api/internal/generations/generationExecutionApi.js`

**Current Flow:**
1. Pre-execution cost calculated from tool's `costingModel` (lines 97-116)
2. Adapter executes and returns ToolResult (line 190)
3. Generation record created with `costUsd: toolResult.costUsd || costUsd` (line 224)
4. Since adapter doesn't return `costUsd`, falls back to pre-calculated value

**Problem:**
- For ChatGPT: Pre-calculated cost uses `staticCost.amount: 0.000002` per token, but actual token count is unknown
- For DALL-E: Pre-calculated cost uses `costTable` lookup (lines 79-87), which works but adapter should still return actual cost
- Pre-calculated costs may be 0 if tool configuration is incorrect

**Evidence:**
```javascript
// Line 224
costUsd: toolResult.costUsd || costUsd, // Falls back to pre-calculated costUsd
```

#### Issue 1.4: Tool Costing Model Configuration

**Location:** `src/core/tools/definitions/chatgpt.js` and `dalleImage.js`

**ChatGPT Configuration:**
```javascript
costingModel: {
  rateSource: 'static',
  staticCost: {
    amount: 0.000002, // Cost per token
    unit: 'token'
  }
}
```

**Problem:** Cost is per token, but actual token count is never retrieved from API response.

**DALL-E Configuration:**
```javascript
costingModel: {
  rateSource: 'static',
  staticCost: {
    amount: 0, // Base cost is 0
    unit: 'run'
  }
},
metadata: {
  costTable: {
    'dall-e-3': {
      '1024x1024': { standard: 0.04, hd: 0.08 },
      // ...
    }
  }
}
```

**Status:** DALL-E costTable lookup works correctly in `generationExecutionApi.js` (lines 79-87), but adapter should still return actual cost for consistency.

## Part 2: Spell Execution Point Accounting Investigation

### Findings

#### Issue 2.1: Critical Bug - Quote Query Matches Wrong Field

**Location:** `src/core/services/SpellsService.js`, line 201

**Problem:**
- `quoteSpell()` queries generation records using `serviceName: toolId`
- But generation records are created with `serviceName: tool.service` (which is 'openai')
- Query will **never match any records** for OpenAI tools

**Evidence:**
```javascript
// SpellsService.js line 201 - Quote query
{ $match: { serviceName: toolId, ... } } // ❌ toolId = 'chatgpt-free' or 'dall-e-3-image'

// generationExecutionApi.js line 213 - Record creation
serviceName: tool.service, // ✅ tool.service = 'openai'
```

**Impact:** Spell quotes return 0 cost because no historical data is found.

**Example:**
- Spell step has `toolId: 'chatgpt-free'`
- Quote query searches for `serviceName: 'chatgpt-free'`
- But generation records have `serviceName: 'openai'`
- Query returns 0 results → `avgCostUsd = 0` → `totalCostPts = 0`

#### Issue 2.2: Cost Aggregation Works Correctly

**Location:** `src/core/services/workflow/management/CostAggregator.js`

**Status:** ✅ **Working correctly**

- Properly fetches generation records by ID
- Correctly sums `costUsd` and `pointsSpent` fields
- Handles null/undefined values gracefully

**Evidence:**
```javascript
// Lines 46-49
totalCostUsd = stepGens.reduce((sum, g) => {
  const val = g.costUsd !== undefined && g.costUsd !== null ? Number(g.costUsd) : 0;
  return sum + (isNaN(val) ? 0 : val);
}, 0);
```

#### Issue 2.3: Step Continuation Cost Tracking

**Location:** `src/core/services/workflow/continuation/StepContinuator.js`

**Status:** ✅ **Working correctly**

- Properly updates cast records with generation costs (line 58)
- Uses `CostAggregator` to sum costs across all steps (line 200)
- Creates final notification record with aggregated costs (line 253)

**Evidence:**
```javascript
// Line 58
completedGeneration.costUsd // Passed to castManager

// Line 200
const { totalCostUsd, totalPointsSpent } = await this.costAggregator.aggregateCosts(stepGenerationIds);
```

#### Issue 2.4: Generation Record Creation for Spell Steps

**Location:** `src/api/internal/generations/generationExecutionApi.js`

**Status:** ⚠️ **Partially working**

- Correctly sets `serviceName: tool.service` (line 213)
- Correctly sets `toolId: tool.toolId` (line 214)
- Sets `costUsd` from adapter result or pre-calculated value (line 224)
- **Problem:** If adapter doesn't return cost and pre-calculated is 0, record has 0 cost

## Part 3: Database Validation

### Script Created

**Location:** `scripts/investigate/spellCostValidation.js`

The script performs:
1. Analysis of OpenAI tool executions in `generationOutputs` collection
2. Analysis of spell casts and their cost aggregation in `casts` collection
3. Cross-reference of spell definitions with execution data

### Expected Database Findings

Based on code analysis, the database validation script should reveal:

1. **OpenAI Tool Executions:**
   - Most records with `serviceName: 'openai'` have `costUsd: 0` or `null`
   - Records with `toolId: 'chatgpt-free'` or `'dall-e-3-image'` exist but queries don't find them
   - Cost coverage percentage likely < 10% for OpenAI tools

2. **Spell Casts:**
   - Many casts have `totalCost: 0` because step generations have 0 cost
   - Casts with OpenAI tool steps show 0 aggregated cost

3. **Spell Quote Analysis:**
   - Queries matching `serviceName: toolId` return 0 results
   - Queries matching `toolId: toolId` would return results (but not used)

## Root Cause Analysis

### Primary Root Cause

The spell cost estimation system has a **fundamental mismatch** between:
- **How generation records are stored:** `serviceName: tool.service` (e.g., 'openai')
- **How quotes query records:** `serviceName: toolId` (e.g., 'chatgpt-free')

This mismatch means quotes can never find historical execution data for OpenAI tools.

### Secondary Root Causes

1. **OpenAI adapter doesn't calculate costs:** Adapter should extract usage data and calculate actual costs
2. **OpenAI service doesn't return usage data:** Service discards token usage information needed for cost calculation
3. **No fallback cost calculation:** When no historical data exists, system returns 0 instead of using tool's costing model

## Recommendations

### Priority 1: Critical Fixes

#### Fix 1: Correct Spell Quote Query

**File:** `src/core/services/SpellsService.js`

**Change:** Update `quoteSpell()` to match on `toolId` instead of `serviceName`

```javascript
// Current (line 201) - WRONG
{ $match: { serviceName: toolId, status: 'completed', ... } }

// Fixed - CORRECT
{ $match: { toolId: toolId, status: 'completed', ... } }
```

**Alternative:** Match on both fields for backward compatibility:
```javascript
{ $match: { 
  $or: [
    { serviceName: toolId },
    { toolId: toolId }
  ],
  status: 'completed',
  ...
} }
```

#### Fix 2: Add Cost Calculation to OpenAI Adapter

**File:** `src/core/services/openai/openAIAdapter.js`

**Changes:**
1. Update `execute()` to return `costUsd` in ToolResult
2. Update `startJob()` to calculate and return actual `costUsd`
3. Extract usage data from OpenAI API responses
4. Calculate costs based on actual token usage (ChatGPT) or costTable (DALL-E)

**Implementation:**
- For ChatGPT: Extract `usage` from completion response, calculate cost based on token counts
- For DALL-E: Use costTable lookup based on model/size/quality parameters

#### Fix 3: Extract Usage Data from OpenAI Service

**File:** `src/core/services/openai/openaiService.js`

**Changes:**
1. Update `executeChatCompletion()` to return both content and usage data
2. Return full completion object or structured response with usage

**Implementation:**
```javascript
return {
  content: responseContent,
  usage: completion.usage // { prompt_tokens, completion_tokens, total_tokens }
};
```

### Priority 2: Enhancements

#### Enhancement 1: Add Fallback Cost Calculation

**File:** `src/core/services/SpellsService.js`

**Change:** When no historical data exists, use tool's costing model to estimate cost

```javascript
if (!stats || stats.avgCostUsd === 0) {
  // Fallback to tool's costing model
  const fallbackCost = calculateFallbackCost(toolId, tool);
  avgCostUsd = fallbackCost;
}
```

#### Enhancement 2: Cost Reconciliation

**File:** `src/core/services/SpellsService.js`

**Change:** Track difference between estimated and actual costs for continuous improvement

### Priority 3: Data Migration

#### Migration: Update Historical Records

**Script:** Create migration script to update existing generation records

**Tasks:**
1. Backfill `costUsd` for OpenAI tool executions where possible
2. Update records with correct `serviceName` if needed
3. Recalculate spell cast costs from updated generation records

## Implementation Plan

### Phase 1: Critical Fixes (Immediate)

1. **Fix spell quote query** (1 hour)
   - Update `SpellsService.quoteSpell()` to match on `toolId`
   - Test with existing spells

2. **Add cost calculation to OpenAI adapter** (4 hours)
   - Update `openAIAdapter.execute()` to calculate and return `costUsd`
   - Update `openAIAdapter.startJob()` to calculate and return `costUsd`
   - Extract usage data from API responses

3. **Extract usage data from OpenAI service** (2 hours)
   - Update `openaiService.executeChatCompletion()` to return usage data
   - Update `openaiService.generateImage()` if needed

### Phase 2: Enhancements (Next Sprint)

4. **Add fallback cost calculation** (2 hours)
   - Implement fallback logic in `quoteSpell()`
   - Use tool's costing model when no historical data

5. **Cost reconciliation tracking** (3 hours)
   - Add fields to track estimated vs actual costs
   - Create analytics endpoint for cost accuracy

### Phase 3: Data Migration (Optional)

6. **Backfill historical costs** (4 hours)
   - Create migration script
   - Update existing generation records where possible
   - Recalculate spell cast costs

## Testing Plan

### Unit Tests

1. Test `SpellsService.quoteSpell()` with corrected query
2. Test `openAIAdapter.execute()` returns `costUsd`
3. Test `openaiService.executeChatCompletion()` returns usage data

### Integration Tests

1. Execute spell with ChatGPT step, verify cost is tracked
2. Execute spell with DALL-E step, verify cost is tracked
3. Generate quote for spell, verify non-zero cost estimate

### Database Validation

1. Run `spellCostValidation.js` script before fixes
2. Apply fixes
3. Run script again to verify improvements

## Conclusion

The spell cost estimation system has **5 critical issues** preventing accurate cost tracking. The primary issue is a **query field mismatch** that prevents quotes from finding historical execution data. Secondary issues involve missing cost calculation in the OpenAI adapter and service layers.

**Recommended immediate action:** Fix the spell quote query (1 hour) and add cost calculation to OpenAI adapter (4 hours). These two fixes will restore basic cost estimation functionality.

The investigation has provided a clear path forward with specific code changes, implementation plan, and testing strategy.

