# Agent Prompt: Fix Frontend Cost HUD Pricing Accuracy - Complete Real-Time Integration

## Problem Statement

The **backend rates API has been successfully updated** to use real-time pricing from `PriceFeedService`, but the **frontend Cost HUD is still displaying incorrect MS2 and CULT token values** due to incomplete integration with the updated backend services.

### Current Status
- ✅ **Backend Fixed**: Internal/External rates APIs now fetch real-time MS2 and CULT prices
- ❌ **Frontend Broken**: Cost HUD still shows hardcoded fallback rates instead of real-time data
- ❌ **Data Flow Incomplete**: Real-time prices not properly flowing from backend to frontend

### Pricing Accuracy Issue
- **Expected**: 119 points ($0.04) = 298 MS2 (at $0.000134) = 57 CULT (at $0.0007)
- **Actual**: 119 points ($0.04) = 0.04 MS2 = 2 CULT (using hardcoded fallback rates)
- **Root Cause**: Frontend not properly consuming real-time pricing data from updated backend APIs

## Current Architecture Analysis

### ✅ What's Working (Backend)
1. **Internal Rates API** (`src/api/internal/economy/ratesApi.js`):
   - ✅ Successfully integrated with `PriceFeedService`
   - ✅ Fetches real-time MS2 and CULT prices from CoinGecko/Alchemy APIs
   - ✅ Proper error handling with fallback to hardcoded rates
   - ✅ 5-minute caching to prevent excessive API calls
   - ✅ Returns accurate rates: MS2_per_USD ≈ 7,462, CULT_per_USD ≈ 1,429

2. **External Rates API** (`src/api/external/economy/ratesApi.js`):
   - ✅ Properly calls internal API for real-time data
   - ✅ Source tracking (internal-api vs fallback)
   - ✅ Comprehensive error handling and logging

3. **PriceFeedService** (`src/core/services/alchemy/priceFeedService.js`):
   - ✅ Fetches real-time MS2 prices from CoinGecko API
   - ✅ Fetches real-time CULT prices from Alchemy Price Feed API
   - ✅ Proper error handling and fallbacks

### ❌ What's Broken (Frontend)
1. **Cost HUD Exchange Rate Loading**: Not properly fetching from updated backend
2. **WebSocket Cost Calculation**: Still using hardcoded fallback rates
3. **Data Flow**: Real-time prices not reaching frontend components
4. **Rate Refresh**: No automatic refresh of exchange rates

## Required Solution

### Primary Goal
Complete the **frontend integration** to properly consume real-time pricing data from the updated backend APIs, ensuring accurate MS2 and CULT token values in the Cost HUD.

### Technical Requirements

#### 1. Frontend Cost HUD Integration
- **Update Cost HUD** (`src/platforms/web/client/src/sandbox/components/costHud.js`):
  - Fix `loadExchangeRates()` to properly fetch from `/api/external/economy/rates`
  - Implement automatic rate refresh (every 5 minutes)
  - Add proper error handling and fallback mechanisms
  - Ensure real-time rates are used for all cost calculations

#### 2. WebSocket Cost Calculation Fix
- **Update websocketHandlers.js** (`src/platforms/web/client/src/sandbox/node/websocketHandlers.js`):
  - Remove hardcoded `FALLBACK_RATES` usage
  - Ensure `getCurrentExchangeRates()` uses real-time rates from CostHUD
  - Fix cost calculation to use accurate exchange rates

#### 3. State Management Integration
- **Update state.js** (`src/platforms/web/client/src/sandbox/state.js`):
  - Ensure cost tracking uses real-time exchange rates
  - Fix any hardcoded rate references

## Current Backend API Response Format

### External API Response (Working)
```json
{
  "success": true,
  "data": {
    "POINTS_per_USD": 2967.36,
    "MS2_per_USD": 7462.0,      // Real-time: 1 / $0.000134
    "CULT_per_USD": 1429.0       // Real-time: 1 / $0.0007
  },
  "timestamp": "2025-01-16T...",
  "requestId": "uuid",
  "source": "internal-api"       // or "fallback"
}
```

## Implementation Strategy

### Phase 1: Fix Cost HUD Exchange Rate Loading
1. **Update `loadExchangeRates()` method**:
   - Ensure proper API endpoint usage
   - Add error handling for API failures
   - Implement automatic refresh mechanism
   - Add logging for debugging

2. **Fix rate initialization**:
   - Load rates on CostHUD initialization
   - Ensure rates are available before cost calculations

### Phase 2: Fix WebSocket Cost Calculation
1. **Update `getCurrentExchangeRates()` function**:
   - Remove hardcoded fallback rates
   - Ensure it uses real-time rates from CostHUD
   - Add proper error handling

2. **Fix cost calculation logic**:
   - Ensure all cost calculations use real-time rates
   - Remove any remaining hardcoded rate references

### Phase 3: Testing and Validation
1. **Test real-time pricing**:
   - Verify Cost HUD shows accurate MS2/CULT values
   - Test automatic rate refresh
   - Test fallback behavior when API fails

2. **Test cost calculations**:
   - Verify new executions use real-time rates
   - Test cost display updates
   - Verify consistency across all components

## Expected Implementation Changes

### 1. Cost HUD Updates (`costHud.js`)
```javascript
// Fix loadExchangeRates method
async loadExchangeRates() {
    try {
        const response = await fetch('/api/external/economy/rates');
        if (response.ok) {
            const data = await response.json();
            this.exchangeRates = data.data;
            console.log('[CostHUD] Loaded real-time exchange rates:', this.exchangeRates);
            console.log('[CostHUD] Data source:', data.source);
            
            // Update display immediately
            this.updateDisplay();
            
            // Schedule next refresh
            this.scheduleRateRefresh();
        } else {
            throw new Error(`API returned ${response.status}`);
        }
    } catch (error) {
        console.error('[CostHUD] Error loading exchange rates:', error);
        // Use fallback rates only if API completely fails
        this.useFallbackRates();
    }
}

// Add automatic refresh
scheduleRateRefresh() {
    // Refresh every 5 minutes
    setTimeout(() => {
        this.loadExchangeRates();
    }, 5 * 60 * 1000);
}
```

### 2. WebSocket Handler Updates (`websocketHandlers.js`)
```javascript
// Fix getCurrentExchangeRates function
function getCurrentExchangeRates() {
    // Try to get rates from CostHUD first (real-time rates)
    if (typeof window !== 'undefined' && window.costHUD && window.costHUD.exchangeRates) {
        console.log('[Cost] Using real-time exchange rates from CostHUD:', window.costHUD.exchangeRates);
        return window.costHUD.exchangeRates;
    }
    
    // If CostHUD not available, try to load rates
    if (typeof window !== 'undefined' && window.costHUD) {
        console.warn('[Cost] CostHUD rates not loaded, attempting to load...');
        window.costHUD.loadExchangeRates();
        // Return a promise or handle async loading
    }
    
    // Only use hardcoded fallback as last resort
    console.warn('[Cost] Using hardcoded fallback rates - this should not happen in normal operation');
    return FALLBACK_RATES;
}
```

## Success Criteria

### ✅ Functional Requirements
1. **Accurate Pricing**: Cost HUD displays correct MS2 and CULT values based on real market prices
2. **Real-Time Updates**: Prices refresh automatically every 5 minutes
3. **Error Handling**: Graceful fallback to hardcoded rates only if API completely fails
4. **Consistency**: Display and new cost calculations use same real-time exchange rates
5. **Performance**: Proper caching prevents excessive API calls

### ✅ Expected Results
With current prices (MS2: $0.000134, CULT: $0.0007):
- **119 points ($0.04) should display**:
  - **298 MS2** (instead of 0.04 MS2) ✅
  - **57 CULT** (instead of 2 CULT) ✅

### ✅ Technical Requirements
1. **No Breaking Changes**: Existing frontend functionality continues working
2. **Backward Compatibility**: Maintains existing API contracts
3. **Comprehensive Logging**: Easy debugging of pricing issues
4. **Rate Limiting**: Proper caching prevents API abuse

## Files to Modify

### Frontend Files
- `src/platforms/web/client/src/sandbox/components/costHud.js` - Main Cost HUD integration
- `src/platforms/web/client/src/sandbox/node/websocketHandlers.js` - Cost calculation fixes
- `src/platforms/web/client/src/sandbox/state.js` - State management updates

### Testing Files
- Update existing test scripts to verify frontend integration
- Create frontend-specific testing utilities

## Dependencies

### ✅ Already Available
- `PriceFeedService` - Backend pricing service
- Internal/External rates APIs - Updated with real-time pricing
- Token addresses from `tokenConfig.js`
- Existing Cost HUD infrastructure

### 🔧 Required
- Frontend API integration fixes
- WebSocket handler updates
- State management improvements

## Testing Strategy

### 1. Backend API Testing
```bash
# Test that backend is working
node scripts/debug/test_rates_api.js
```

### 2. Frontend Integration Testing
```javascript
// In browser console
window.refreshExchangeRates();
console.log('Current rates:', window.costHUD.exchangeRates);
// Should show: MS2_per_USD: ~7462, CULT_per_USD: ~1429
```

### 3. Cost Calculation Testing
```javascript
// Test cost calculation with real rates
window.testCostHUD();
// Should show accurate MS2/CULT values
```

## Implementation Notes

### Key Points
1. **Backend is already working** - focus on frontend integration
2. **Real-time rates are available** - just need to consume them properly
3. **Fallback rates should rarely be used** - only if API completely fails
4. **Maintain existing functionality** - don't break current features

### Common Pitfalls to Avoid
1. **Don't use hardcoded rates** - always fetch from API
2. **Don't break existing cost tracking** - maintain backward compatibility
3. **Don't forget error handling** - API calls can fail
4. **Don't skip rate refresh** - prices change over time

## Success Validation

### Immediate Validation
1. Open sandbox in browser
2. Check Cost HUD shows accurate MS2/CULT values
3. Run `window.refreshExchangeRates()` in console
4. Verify rates update to real-time values

### Long-term Validation
1. Monitor Cost HUD for 5+ minutes
2. Verify rates refresh automatically
3. Test with API failures (network issues)
4. Verify fallback behavior works correctly

---

**Priority**: High - Users currently see incorrect token values  
**Complexity**: Medium - Frontend integration with existing backend  
**Impact**: High - Fixes major pricing accuracy issue  
**Dependencies**: Backend APIs already working ✅
